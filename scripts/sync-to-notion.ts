#!/usr/bin/env npx ts-node
/**
 * sync-to-notion.ts
 * Supabase affiliate_creators → Notion DB 동기화 스크립트
 *
 * 사용법:
 *   npx ts-node scripts/sync-to-notion.ts [project] [status] [notion-db-id]
 *
 * 예시:
 *   npx ts-node scripts/sync-to-notion.ts "DF_KOL" "단가 받음 진행 가능" "315c05e83dcc801b8d48fd06af9966c1"
 *
 * 환경변수 (.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NOTION_TOKEN
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── .env.local 로드 ──────────────────────────────────────────────────────
const envPath = resolve(__dirname, '../.env.local');
const envContent = readFileSync(envPath, 'utf-8');
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim();
  if (!process.env[key]) process.env[key] = val;
}

// ── CONFIG ───────────────────────────────────────────────────────────────
// CLI args 또는 기본값 (매번 달라지는 값은 여기서만 수정)
// 사용법: npx ts-node ... [project] [status] [notion-db-id] [type]
const PROJECT       = process.argv[2] || 'DF_KOL';
const STATUS        = process.argv[3] || '단가 받음 진행 가능';
const NOTION_DB_ID  = process.argv[4] || '315c05e83dcc801b8d48fd06af9966c1';
const CREATOR_TYPE  = process.argv[5] || 'KOL'; // Notion type select 값

const NOTION_TOKEN  = process.env.NOTION_TOKEN!;
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!NOTION_TOKEN) {
  console.error('❌ NOTION_TOKEN이 .env.local에 없습니다');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Supabase 환경변수가 없습니다');
  process.exit(1);
}

// ── 유틸 함수 ────────────────────────────────────────────────────────────
function formatNumber(n: number | string | null | undefined): string {
  if (n == null || n === '') return '';
  const num = Number(n);
  if (isNaN(num)) return String(n);
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000)     return (num / 1_000).toFixed(1) + 'K';
  return num.toLocaleString();
}

function formatCurrency(n: number | string | null | undefined): string {
  if (n == null || n === '') return '';
  const num = Number(n);
  if (isNaN(num)) return String(n);
  return '$' + num.toLocaleString();
}

function richText(text: string) {
  if (!text) return [];
  return [{ text: { content: text.slice(0, 2000) } }]; // Notion 최대 2000자
}

function normalizeHandle(handle: string): string {
  return handle.replace(/^@/, '').toLowerCase().trim();
}

// ── Notion API ───────────────────────────────────────────────────────────
async function notionRequest(method: string, path: string, body?: unknown) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion API ${method} ${path} → ${res.status}: ${err}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

/** Notion DB에 이미 있는 handle 목록 조회 (중복 체크용) */
async function getExistingHandles(dbId: string): Promise<Set<string>> {
  const handles = new Set<string>();
  let cursor: string | null = null;

  while (true) {
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const data = await notionRequest('POST', `/databases/${dbId}/query`, body);
    const results = data.results as Array<Record<string, unknown>>;

    for (const page of results) {
      const props = page.properties as Record<string, Record<string, unknown>>;

      // TikTok Handle 필드 확인
      const handleProp = props['TikTok Handle'];
      const richTextArr = handleProp?.rich_text as Array<{ plain_text: string }> | undefined;
      if (richTextArr?.length) {
        handles.add(normalizeHandle(richTextArr[0].plain_text));
      }

      // Name(title) 필드도 확인
      const nameProp = props['Name'];
      const titleArr = nameProp?.title as Array<{ plain_text: string }> | undefined;
      if (titleArr?.length) {
        handles.add(normalizeHandle(titleArr[0].plain_text));
      }
    }

    if (!data.has_more) break;
    cursor = data.next_cursor as string;
  }

  return handles;
}

/** Notion DB에 새 페이지 생성 */
async function createNotionPage(
  dbId: string,
  row: Record<string, unknown>
): Promise<void> {
  const handle     = String(row.handle || '');
  const cleanHandle = handle.replace(/^@/, '');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const properties: Record<string, any> = {
    'Name': {
      title: [{ text: { content: handle } }],
    },
  };

  // TikTok Handle
  if (cleanHandle) {
    properties['TikTok Handle']       = { rich_text: richText(handle) };
    properties['TikTok 프로필 링크']   = { url: `https://www.tiktok.com/@${cleanHandle}` };
  }

  // 팔로워 수
  const followersStr = formatNumber(row.followers as number | null);
  if (followersStr) {
    properties['팔로워 수'] = { rich_text: richText(followersStr) };
  }

  // GMV (30일)
  const gmvStr = formatCurrency(row.gmv as number | null);
  if (gmvStr) {
    properties['GMV (30일)'] = { rich_text: richText(gmvStr) };
  }

  // 영상 단가 (Min / Max)
  if (row.min_price != null && row.min_price !== '') {
    properties['영상 단가 (Min)'] = { number: Number(row.min_price) };
  }
  if (row.max_price != null && row.max_price !== '') {
    properties['영상 단가 (Max)'] = { number: Number(row.max_price) };
  }

  // 단가 메모
  if (row.price_comment) {
    properties['단가 메모'] = { rich_text: richText(String(row.price_comment)) };
  }

  // 추천 사유
  if (row.recommendation_reason) {
    properties['추천 사유'] = { rich_text: richText(String(row.recommendation_reason)) };
  }

  // type: CLI arg로 지정 (기본 KOL)
  properties['type'] = { select: { name: CREATOR_TYPE } };

  // 추천 등급 (tier)
  if (row.tier != null) {
    properties['추천 등급'] = { select: { name: String(row.tier) } };
  }

  await notionRequest('POST', '/pages', {
    parent: { database_id: dbId },
    properties,
  });
}

// ── 메인 ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🔄 Notion 동기화 시작');
  console.log(`   📁 Project : ${PROJECT}`);
  console.log(`   🏷  Status  : ${STATUS}`);
  console.log(`   📋 Notion DB: ${NOTION_DB_ID}\n`);

  // 1. Supabase에서 데이터 조회
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data: rows, error } = await supabase
    .from('affiliate_creators')
    .select('*')
    .eq('project', PROJECT)
    .eq('status', STATUS);

  if (error) {
    console.error('❌ Supabase 오류:', error.message);
    process.exit(1);
  }

  console.log(`✅ Supabase: ${rows?.length ?? 0}개 데이터 조회됨`);

  // 2. Notion 기존 항목 조회 (중복 체크)
  console.log('📋 Notion 기존 항목 확인 중...');
  const existingHandles = await getExistingHandles(NOTION_DB_ID);
  console.log(`   이미 Notion에 있는 항목: ${existingHandles.size}개`);

  // 3. 신규 항목 필터
  const newRows = (rows ?? []).filter(row => {
    const handle = normalizeHandle(String(row.handle || ''));
    return handle && !existingHandles.has(handle);
  });

  const skipped = (rows?.length ?? 0) - newRows.length;
  console.log(`\n📊 신규: ${newRows.length}개 추가 예정 | 중복 스킵: ${skipped}개\n`);

  if (newRows.length === 0) {
    console.log('✅ 모든 항목이 이미 Notion에 있습니다. 동기화할 내용 없음.');
    return;
  }

  // 4. Notion 페이지 생성
  let success = 0;
  let failed  = 0;

  for (const row of newRows) {
    try {
      await createNotionPage(NOTION_DB_ID, row as Record<string, unknown>);
      console.log(`  ✅ ${row.handle}`);
      success++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ❌ ${row.handle}: ${msg}`);
      failed++;
    }
    // Notion rate limit: ~3 req/sec
    await new Promise(r => setTimeout(r, 350));
  }

  console.log(`\n🎉 완료! 추가 ${success}개 | 실패 ${failed}개`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
