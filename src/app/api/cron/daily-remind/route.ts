import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  COMPOSE_PC_FIELDS,
  COMPOSE_PROJECT_FIELDS,
  deriveThreadInfo,
  renderComposedEmail,
  toReplySubject,
  type ThreadInfo,
  type ThreadMessageRow,
} from '@/lib/email-service';
import { expandProductBriefItems, fetchBundleComponents } from '@/lib/product-briefs';
import { escalateToSlack } from '@/lib/slack';
import { isDemoBrandId } from '@/lib/demo';

/**
 * daily-remind — 매일 대상 project_creator 를 전부 평가해 리마인드 초안을 만들고
 * 필요한 건은 슬랙으로 에스컬레이션한다.
 *
 * ★ 2026-08-12: 순차 N+1 을 배치 조회로 바꿨다.
 *   그 전에는 대상 138건을 돌면서 건당 DB 왕복을 5~8회 했다(실측 718회, 156초).
 *   maxDuration=120 이라 매일 중간에 잘렸고, 최근 7일 도달 순번은 53·70·76·81·78·76·54 였다.
 *   즉 **명단 뒤쪽 절반(약 57~85건)은 몇 달째 한 번도 평가되지 않았다.**
 *
 *   지금은 조회를 앞에서 한 번에 끝내고(고정 6~8회) 판정은 메모리에서 한다.
 *   쓰기도 초안·마커를 각각 한 번에 모아 넣는다. 슬랙 왕복만 알림 건수만큼 남는다.
 */

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

function verifyCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get('authorization');
  if (auth === `Bearer ${secret}`) return true;
  const param = req.nextUrl.searchParams.get('secret');
  return param === secret;
}

/** Pro 플랜 상한. 배치 조회 뒤엔 몇 초면 끝나지만 슬랙 발송이 몰릴 때를 위한 여유. */
export const maxDuration = 300;

/** URL 길이 때문에 in() 은 나눠 부른다. uuid 60개 ≈ 2.2KB. */
const ID_CHUNK = 60;
/** PostgREST 한 번에 가져올 행 수. */
const PAGE = 1000;

const TEMPLATE_SLUGS = ['remind_sign_contract', 'post_sign_shipping_off', 'remind_post_video_v2'] as const;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 대상 pc 들의 email_messages 를 한 번에 읽는다(페이지네이션 포함). */
async function fetchMessagesFor(supabase: SupabaseClient, pcIds: string[]) {
  const rows: MessageRow[] = [];
  for (const ids of chunk(pcIds, ID_CHUNK)) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('email_messages')
        .select('project_creator_id, direction, gmail_thread_id, message_id_header, subject, sent_at, received_at, created_at, escalated, escalation_reason')
        .in('project_creator_id', ids)
        .order('created_at', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`email_messages fetch failed: ${error.message}`);
      if (!data?.length) break;
      rows.push(...(data as MessageRow[]));
      if (data.length < PAGE) break;
    }
  }
  return rows;
}

interface MessageRow extends ThreadMessageRow {
  project_creator_id: string | null;
  direction: string | null;
  sent_at: string | null;
  received_at: string | null;
  escalated: boolean | null;
  escalation_reason: string | null;
}

function groupBy<T>(rows: T[], key: (row: T) => string | null | undefined): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(row);
  }
  return map;
}

function maxDate(rows: MessageRow[], pick: (row: MessageRow) => string | null): Date | null {
  let best: number | null = null;
  for (const row of rows) {
    const raw = pick(row);
    if (!raw) continue;
    const t = Date.parse(raw);
    if (Number.isNaN(t)) continue;
    if (best === null || t > best) best = t;
  }
  return best === null ? null : new Date(best);
}

interface PendingEscalation {
  pcId: string;
  reason: string;
  escalationReason: 'signed_shipping_on' | '7_days_no_reply';
  subject: string;
  classification?: string;
  creatorName: string;
  creatorEmail?: string;
  projectName: string;
}

/** GET /api/cron/daily-remind — Create reminder drafts + escalate */
export async function GET(req: NextRequest) {
  if (!verifyCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getServiceClient();
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const today = now.toISOString().split('T')[0];
  const startedAt = Date.now();

  // ── 1. 대상 목록 (composeEmail 이 쓰는 필드까지 한 번에) ──
  const { data: allPcs, error: pcError } = await supabase
    .from('project_creators')
    .select(`
      signed_at, created_at,
      ${COMPOSE_PC_FIELDS},
      project:projects!inner(${COMPOSE_PROJECT_FIELDS}, status, brand_id),
      videos(id)
    `)
    .eq('project.status', 'active')
    .or('is_deleted.is.null,is_deleted.eq.false');

  if (pcError) {
    return NextResponse.json({ error: `project_creators fetch failed: ${pcError.message}` }, { status: 500 });
  }
  if (!allPcs?.length) {
    return NextResponse.json({ message: 'No active project creators' });
  }

  // ── 2. 조회 없이 거를 수 있는 건 먼저 거른다 ──
  const targets = (allPcs as any[]).filter((pc) => {
    if (isDemoBrandId(pc.project?.brand_id)) return false;
    return new Date(pc.created_at) <= oneDayAgo;
  });

  const pcIds = targets.map((pc) => pc.id as string);

  if (!pcIds.length) {
    return NextResponse.json({
      considered: allPcs.length,
      evaluated: 0,
      remind_sign: 0,
      remind_post_sign: 0,
      remind_post: 0,
      escalated: 0,
      escalation_failed: 0,
      elapsed_ms: Date.now() - startedAt,
    });
  }

  // ── 3. 나머지 조회를 전부 배치로 ──
  const draftIdsToday = new Set<string>();
  for (const ids of chunk(pcIds, ID_CHUNK)) {
    const { data, error } = await supabase
      .from('email_drafts')
      .select('project_creator_id')
      .in('project_creator_id', ids)
      .gte('created_at', today);
    if (error) {
      return NextResponse.json({ error: `email_drafts fetch failed: ${error.message}` }, { status: 500 });
    }
    for (const row of data || []) {
      if (row.project_creator_id) draftIdsToday.add(row.project_creator_id);
    }
  }

  let messages: MessageRow[];
  try {
    messages = await fetchMessagesFor(supabase, pcIds);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
  const messagesByPc = groupBy(messages, (m) => m.project_creator_id);

  const { data: templateRows } = await supabase
    .from('email_templates')
    .select('slug, subject, body_html')
    .in('slug', TEMPLATE_SLUGS as unknown as string[]);
  const templates = new Map<string, { subject: string; body_html: string }>();
  for (const t of templateRows || []) {
    templates.set(t.slug, { subject: t.subject, body_html: t.body_html });
  }

  const bundleIds = targets.flatMap((pc: any) =>
    (pc.project_creator_products || [])
      .map((p: any) => p.product)
      .filter((p: any) => p?.id && p.is_bundle)
      .map((p: any) => p.id as string)
  );
  const componentsByBundle = await fetchBundleComponents(bundleIds, supabase);

  // ── 4. 판정은 전부 메모리에서 ──
  const draftsToInsert: any[] = [];
  const pendingEscalations: PendingEscalation[] = [];
  let evaluated = 0;
  let remindSign = 0;
  let remindPostSign = 0;
  let remindPost = 0;
  let composeFailed = 0;

  const buildDraft = (pc: any, slug: string, threadInfo: ThreadInfo) => {
    const draft = renderComposedEmail({
      pc,
      templateSlug: slug,
      template: templates.get(slug) || null,
      briefItems: expandProductBriefItems(pc.project_creator_products, componentsByBundle),
    });
    return {
      project_creator_id: pc.id,
      // Gmail 은 스레드에 붙일 때 Subject 가 스레드 Subject 와 같아야 한다.
      draft_subject: threadInfo.originalSubject ? toReplySubject(threadInfo.originalSubject) : draft.subject,
      draft_body_html: draft.bodyHtml,
      classification: 'reminder',
      status: 'pending',
      gmail_thread_id: threadInfo.gmailThreadId,
      in_reply_to: threadInfo.inReplyTo,
    };
  };

  for (const pc of targets) {
    evaluated++;

    const creator = pc.creator as any;
    const project = pc.project as any;
    const brand = project?.brand as any;
    const videos = (pc.videos || []) as any[];
    const createdAt = new Date(pc.created_at);
    const signedAt = pc.signed_at ? new Date(pc.signed_at) : null;
    const pcMessages = messagesByPc.get(pc.id) || [];

    if (draftIdsToday.has(pc.id)) continue;

    const threadInfo = deriveThreadInfo(pcMessages);
    const creatorName = creator?.tiktok_handle || creator?.name || 'Unknown';
    const projectName = `${brand?.name} / ${project?.name}`;

    // ── Case 1: Contract not signed ──
    if (!signedAt) {
      try {
        draftsToInsert.push(buildDraft(pc, 'remind_sign_contract', threadInfo));
        remindSign++;
      } catch { composeFailed++; }
      continue;
    }

    // ── Case 2: Signed + shipping ON → escalate for direct shipping ──
    if (project?.require_shipping_address === true) {
      const alreadyEscalated = pcMessages.some((m) => m.escalation_reason === 'signed_shipping_on');
      if (!alreadyEscalated) {
        pendingEscalations.push({
          pcId: pc.id,
          reason: 'Signed + Shipping ON — Direct shipping needed',
          escalationReason: 'signed_shipping_on',
          subject: '[System] Signed + Shipping ON escalation',
          creatorName,
          creatorEmail: creator?.email,
          projectName,
        });
      }
      continue;
    }

    // ── Case 3: Signed + shipping OFF + recently signed (within 3 days) → post-sign follow-up ──
    if (signedAt > threeDaysAgo && videos.length === 0) {
      try {
        draftsToInsert.push(buildDraft(pc, 'post_sign_shipping_off', threadInfo));
        remindPostSign++;
      } catch { composeFailed++; }
      continue;
    }

    // ── Case 4: Signed + no videos + signed > 3 days ago → posting reminder ──
    if (signedAt < threeDaysAgo && videos.length === 0) {
      try {
        draftsToInsert.push(buildDraft(pc, 'remind_post_video_v2', threadInfo));
        remindPost++;
      } catch { composeFailed++; }
    }

    // ── Case 5: 7+ days no reply → escalate ──
    const hasOutbound = pcMessages.some((m) => m.direction === 'outbound');
    if (!hasOutbound) continue;

    const lastReply = maxDate(pcMessages.filter((m) => m.direction === 'inbound'), (m) => m.received_at);
    const noReplyFor7Days = !lastReply && createdAt < sevenDaysAgo;
    const lastReplyOlderThan7Days = !!lastReply && lastReply < sevenDaysAgo;
    if (!noReplyFor7Days && !lastReplyOlderThan7Days) continue;

    const recentlyEscalated = pcMessages.some(
      (m) =>
        m.escalated === true &&
        m.escalation_reason === '7_days_no_reply' &&
        !!m.created_at &&
        new Date(m.created_at) >= sevenDaysAgo
    );
    if (recentlyEscalated) continue;

    pendingEscalations.push({
      pcId: pc.id,
      reason: '7+ Days No Reply',
      escalationReason: '7_days_no_reply',
      subject: '[System] 7-day no reply escalation',
      classification: 'escalation',
      creatorName,
      creatorEmail: creator?.email,
      projectName,
    });
  }

  // ── 5. 쓰기: 초안은 한 번에 ──
  if (draftsToInsert.length) {
    const { error } = await supabase.from('email_drafts').insert(draftsToInsert);
    if (error) {
      return NextResponse.json({ error: `email_drafts insert failed: ${error.message}` }, { status: 500 });
    }
  }

  // ── 6. 에스컬레이션: 슬랙이 실제로 받은 건에만 마커를 남긴다 ──
  //
  // 마커를 먼저 남기면 발송이 실패해도 "이미 보냈다"로 남아 다시는 안 나간다.
  // signed_shipping_on 은 기간 조건이 없는 영구 마커라 특히 위험하다.
  // 성공한 건만 기록하면 실패한 건은 다음 실행에서 자연히 재시도된다.
  const escalationMarkers: any[] = [];
  const escalationFailures: { pcId: string; reason: string; error?: string }[] = [];

  for (const esc of pendingEscalations) {
    const result = await escalateToSlack({
      reason: esc.reason,
      creatorName: esc.creatorName,
      creatorEmail: esc.creatorEmail,
      projectName: esc.projectName,
      adminLink: `${process.env.NEXT_PUBLIC_APP_URL || ''}/admin/email-queue`,
    });

    if (!result.ok) {
      escalationFailures.push({ pcId: esc.pcId, reason: esc.escalationReason, error: result.error });
      continue;
    }

    escalationMarkers.push({
      project_creator_id: esc.pcId,
      direction: 'inbound',
      from_email: esc.creatorEmail || (esc.escalationReason === 'signed_shipping_on' ? 'system' : 'unknown'),
      to_email: 'system',
      subject: esc.subject,
      ...(esc.classification ? { classification: esc.classification } : {}),
      escalated: true,
      escalation_reason: esc.escalationReason,
      received_at: now.toISOString(),
    });
  }

  if (escalationMarkers.length) {
    const { error } = await supabase.from('email_messages').insert(escalationMarkers);
    if (error) {
      // 마커를 못 남기면 내일 또 나간다. 조용히 넘기지 말고 알린다.
      console.error('escalation marker insert failed:', error.message);
    }
  }

  if (escalationFailures.length) {
    console.error(`Slack escalation failed for ${escalationFailures.length} project_creators`, escalationFailures);
  }

  return NextResponse.json({
    considered: allPcs.length,
    evaluated,
    remind_sign: remindSign,
    remind_post_sign: remindPostSign,
    remind_post: remindPost,
    escalated: escalationMarkers.length,
    escalation_failed: escalationFailures.length,
    compose_failed: composeFailed,
    elapsed_ms: Date.now() - startedAt,
  });
}
