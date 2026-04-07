import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { estimatePrice } from '../src/lib/pricing';
import crypto from 'crypto';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq === -1) continue;
  if (!process.env[t.slice(0, eq).trim()]) process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
}

const APP_KEY = process.env.TIKTOK_APP_KEY!;
const APP_SECRET = process.env.TIKTOK_APP_SECRET!;
const SHOP_ID = process.env.TIKTOK_SHOP_ID!;
const TIKTOK_DB_URL = process.env.TIKTOK_DB_SUPABASE_URL!;
const TIKTOK_DB_KEY = process.env.TIKTOK_DB_SUPABASE_KEY!;

function extractPath(url: string) { return new URL(url).pathname; }
function extractParams(url: string) {
  const u = new URL(url); const p: Record<string, string | number> = {};
  u.searchParams.forEach((v, k) => { p[k] = v; }); return p;
}
function generateSign(secret: string, rawUrl: string, body?: Record<string, unknown>) {
  const ts = Math.floor(Date.now() / 1000);
  const paramsObj = extractParams(rawUrl); paramsObj['timestamp'] = ts;
  delete paramsObj['sign']; delete paramsObj['access_token'];
  const sorted = Object.keys(paramsObj).sort().reduce((o, k) => { o[k] = paramsObj[k]; return o; }, {} as Record<string, string | number>);
  let s = secret + extractPath(rawUrl);
  for (const key in sorted) s += key + sorted[key];
  s += (body && Object.keys(body).length > 0) ? JSON.stringify(body) + secret : secret;
  return { sign: crypto.createHmac('sha256', secret).update(s).digest('hex'), ts };
}

async function main() {
  // Load previous handles
  const OUTPUT_DIR = resolve(process.cwd(), 'data/creator-lists');
  const previousHandles = new Set<string>();
  for (const file of readdirSync(OUTPUT_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      const data = JSON.parse(readFileSync(resolve(OUTPUT_DIR, file), 'utf-8'));
      for (const c of data.creators || []) {
        if (c.handle) previousHandles.add(c.handle.toLowerCase().replace(/^@/, ''));
      }
    } catch {}
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: existingAff } = await supabase.from('affiliate_creators').select('handle');
  const dbHandles = new Set((existingAff || []).map(a => (a.handle || '').toLowerCase().replace(/^@/, '')));
  console.log(`Previous: ${previousHandles.size} | DB: ${dbHandles.size}`);

  // Parse CSV
  const csvContent = readFileSync('/Users/jun/Downloads/단가표 3월 - creator_pricing_v2_db (1).csv', 'utf-8');
  const lines = csvContent.replace(/\r/g, '').split('\n').filter(Boolean);
  const rows = lines.slice(1);

  const seen = new Set<string>();
  const creators: { handle: string; min_price: number; max_price: number; price_comment: string }[] = [];
  for (const line of rows) {
    // Split on first 4 commas only (price_comment may contain commas)
    const parts = line.split(',');
    if (parts.length < 4) continue;
    const handle = (parts[1] || '').trim().toLowerCase().replace(/^@/, '');
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);

    creators.push({
      handle,
      min_price: parseFloat(parts[2]) || 0,
      max_price: parseFloat(parts[3]) || 0,
      price_comment: parts.slice(4).join(',').replace(/^"|"$/g, '').trim(),
    });
  }

  console.log(`CSV: ${rows.length} | After dedup+overlap: ${creators.length}\n`);

  // TikTok creds
  const tikDb = createClient(TIKTOK_DB_URL, TIKTOK_DB_KEY);
  const { data: credRows } = await tikDb.from('user_tiktok_info').select('access_token, shop_cipher').eq('shop_id', SHOP_ID).is('deleted_at', null).order('updated_at', { ascending: false }).limit(1);
  if (!credRows?.length) throw new Error('No creds');
  const creds = { appKey: APP_KEY, appSecret: APP_SECRET, accessToken: credRows[0].access_token, shopId: SHOP_ID, shopCipher: credRows[0].shop_cipher };

  interface Result { handle: string; gmv: number; avg_view: number; min_price: number; max_price: number; price_comment: string; tier: string }
  const results: Result[] = [];

  for (let i = 0; i < creators.length; i++) {
    const c = creators[i];
    const body = { keyword: c.handle };
    const qp = `page_size=12&app_key=${creds.appKey}&shop_id=${creds.shopId}&shop_cipher=${creds.shopCipher}&access_token=${creds.accessToken}`;
    const baseUrl = 'https://open-api.tiktokglobalshop.com/affiliate_seller/202508/marketplace_creators/search';
    const rawUrl = `${baseUrl}?${qp}`;
    const { sign, ts } = generateSign(creds.appSecret, rawUrl, body);
    const signedUrl = `${rawUrl}&sign=${sign}&timestamp=${ts}`;

    const response = await fetch(signedUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tts-access-token': creds.accessToken },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    let apiMatch: any = null;
    if (result.code === 0 && result.data?.creators?.length) {
      apiMatch = result.data.creators.find((cr: any) => (cr.username || '').toLowerCase() === c.handle) || null;
    }

    const gmv = apiMatch?.gmv?.amount ? parseFloat(apiMatch.gmv.amount) : 0;
    const avgView = apiMatch?.avg_ec_video_view_count || 0;

    let tier = '';
    if (c.min_price > 0 && avgView > 0) {
      const est = estimatePrice(avgView, gmv);
      const low = Math.round(est.estimated_price * 0.75 / 25) * 25;
      const high = Math.round(est.estimated_price * 1.35 / 25) * 25;
      if (c.min_price < low) tier = '1';
      else if (c.min_price > high) tier = '3';
      else tier = '2';
    }

    results.push({ handle: c.handle, gmv, avg_view: avgView, min_price: c.min_price, max_price: c.max_price, price_comment: c.price_comment, tier });
    process.stdout.write(`[${i+1}/${creators.length}] @${c.handle} GMV:${Math.round(gmv)} avg:${avgView} tier:${tier || '-'}\n`);
    await new Promise(r => setTimeout(r, 350));
  }

  const outHeader = 'handle,gmv,avg_view,min_price_per_content,max_price_per_content,price_comment,tier';
  const outRows = results.map(r => [
    r.handle, Math.round(r.gmv), r.avg_view, r.min_price, r.max_price,
    `"${(r.price_comment || '').replace(/"/g, '""')}"`, r.tier
  ].join(','));
  const outPath = resolve(OUTPUT_DIR, 'pricing-enriched-2026-03-31.csv');
  writeFileSync(outPath, outHeader + '\n' + outRows.join('\n'));

  const t1 = results.filter(r => r.tier === '1').length;
  const t2 = results.filter(r => r.tier === '2').length;
  const t3 = results.filter(r => r.tier === '3').length;
  console.log(`\nSaved: ${outPath} (${results.length} creators)`);
  console.log(`Tier 1: ${t1} | Tier 2: ${t2} | Tier 3: ${t3} | No tier: ${results.length - t1 - t2 - t3}`);
}

main().catch(console.error);
