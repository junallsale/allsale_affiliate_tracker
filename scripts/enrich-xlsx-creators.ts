/**
 * Read Creator IDs from xlsx, dedup against previous exports + DB,
 * enrich with TikTok API (gmv, avg_view, followers, units_sold_range),
 * merge with xlsx data (Video/Live GMV), save CSV.
 */
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { resolve } from "path";

// xlsx via /tmp install
const XLSX = require("/private/tmp/node_modules/xlsx");

// Load env
const envPath = resolve(process.cwd(), ".env.local");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  if (!process.env[t.slice(0, eq).trim()]) process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
}

const APP_KEY = process.env.TIKTOK_APP_KEY!;
const APP_SECRET = process.env.TIKTOK_APP_SECRET!;
const SHOP_ID = process.env.TIKTOK_SHOP_ID!;
const TIKTOK_DB_URL = process.env.TIKTOK_DB_SUPABASE_URL!;
const TIKTOK_DB_KEY = process.env.TIKTOK_DB_SUPABASE_KEY!;
const OUTPUT_DIR = resolve(process.cwd(), "data/creator-lists");

// ── Signing ──
function extractPath(url: string) { return new URL(url).pathname; }
function extractParams(url: string) {
  const u = new URL(url); const p: Record<string, string | number> = {};
  u.searchParams.forEach((v, k) => { p[k] = v; }); return p;
}
function generateSign(secret: string, rawUrl: string, body?: Record<string, unknown>) {
  const ts = Math.floor(Date.now() / 1000);
  const paramsObj = extractParams(rawUrl); paramsObj["timestamp"] = ts;
  delete paramsObj["sign"]; delete paramsObj["access_token"];
  const sorted = Object.keys(paramsObj).sort().reduce((o, k) => { o[k] = paramsObj[k]; return o; }, {} as Record<string, string | number>);
  let s = secret + extractPath(rawUrl);
  for (const key in sorted) s += key + sorted[key];
  s += (body && Object.keys(body).length > 0) ? JSON.stringify(body) + secret : secret;
  return { sign: crypto.createHmac("sha256", secret).update(s).digest("hex"), ts };
}

// ── Load previous handles ──
function loadPreviousHandles(): Set<string> {
  const handles = new Set<string>();
  if (!existsSync(OUTPUT_DIR)) return handles;
  for (const file of readdirSync(OUTPUT_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const data = JSON.parse(readFileSync(resolve(OUTPUT_DIR, file), "utf-8"));
      for (const c of data.creators || []) {
        if (c.handle) handles.add(c.handle.toLowerCase());
      }
    } catch { /* skip */ }
  }
  return handles;
}

async function main() {
  // 1. Read xlsx
  const wb = XLSX.readFile("/Users/jun/Downloads/Ecommerce_Creators_20260323_140105.xlsx");
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws) as Record<string, any>[];
  console.log(`Excel: ${rows.length} rows\n`);

  // Build xlsx data map
  const xlsxMap = new Map<string, Record<string, any>>();
  for (const row of rows) {
    const id = (row["Creator ID"] || "").toString().trim().toLowerCase().replace(/^@/, "");
    if (id) xlsxMap.set(id, row);
  }

  // 2. Dedup against previous exports
  const previousHandles = loadPreviousHandles();
  console.log(`Previous exports: ${previousHandles.size} handles`);

  // Also check DB
  const trackerSupabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: existingAffiliates } = await trackerSupabase.from("affiliate_creators").select("handle");
  const existingHandles = new Set((existingAffiliates || []).map(a => (a.handle || "").toLowerCase().replace(/^@/, "")));
  console.log(`DB affiliate_creators: ${existingHandles.size} handles\n`);

  const allHandles = [...xlsxMap.keys()];
  const newHandles = allHandles.filter(h => !previousHandles.has(h) && !existingHandles.has(h));
  const dupHandles = allHandles.filter(h => previousHandles.has(h) || existingHandles.has(h));

  console.log(`Total: ${allHandles.length} | New: ${newHandles.length} | Duplicates: ${dupHandles.length}\n`);

  if (dupHandles.length > 0) {
    console.log(`Duplicates skipped: ${dupHandles.slice(0, 20).join(", ")}${dupHandles.length > 20 ? ` ... +${dupHandles.length - 20} more` : ""}\n`);
  }

  // 3. TikTok API credentials
  const supabase = createClient(TIKTOK_DB_URL, TIKTOK_DB_KEY);
  const { data: credRows } = await supabase.from("user_tiktok_info").select("access_token, shop_cipher").eq("shop_id", SHOP_ID).is("deleted_at", null).order("updated_at", { ascending: false }).limit(1);
  if (!credRows?.length) throw new Error("No TikTok credentials");
  const creds = { appKey: APP_KEY, appSecret: APP_SECRET, accessToken: credRows[0].access_token, shopId: SHOP_ID, shopCipher: credRows[0].shop_cipher };

  // 4. Enrich each new handle via keyword search
  interface EnrichedRow {
    handle: string;
    tiktok_gmv: string;
    avg_view: number;
    followers: number;
    units_sold_range: string;
    units_sold_min: number;
    // from xlsx
    xlsx_video_gmv: number;
    xlsx_live_gmv: number;
    xlsx_total_gmv: number;
    xlsx_followers: number;
    xlsx_products: number;
    xlsx_categories: string;
    found_in_api: boolean;
  }

  const results: EnrichedRow[] = [];

  for (let i = 0; i < newHandles.length; i++) {
    const handle = newHandles[i];
    const xlsxRow = xlsxMap.get(handle)!;

    // TikTok API keyword search
    const body = { keyword: handle };
    let qp = `page_size=12&app_key=${creds.appKey}&shop_id=${creds.shopId}&shop_cipher=${creds.shopCipher}&access_token=${creds.accessToken}`;
    const baseUrl = "https://open-api.tiktokglobalshop.com/affiliate_seller/202508/marketplace_creators/search";
    const rawUrl = `${baseUrl}?${qp}`;
    const { sign, ts } = generateSign(creds.appSecret, rawUrl, body);
    const signedUrl = `${rawUrl}&sign=${sign}&timestamp=${ts}`;

    const response = await fetch(signedUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-tts-access-token": creds.accessToken },
      body: JSON.stringify(body),
    });

    const result = await response.json();
    let apiData: any = null;

    if (result.code === 0 && result.data?.creators?.length) {
      apiData = result.data.creators.find((c: any) => (c.username || "").toLowerCase() === handle.toLowerCase()) || null;
    }

    const gmvObj = apiData?.gmv as { amount?: string } | undefined;
    const usr = apiData?.units_sold_range as { formatted_range?: string; minimum_amount?: number } | undefined;

    const row: EnrichedRow = {
      handle,
      tiktok_gmv: gmvObj?.amount || "",
      avg_view: apiData?.avg_ec_video_view_count || 0,
      followers: apiData?.follower_count || 0,
      units_sold_range: usr?.formatted_range || "-",
      units_sold_min: usr?.minimum_amount || 0,
      xlsx_video_gmv: xlsxRow["Video ECommerce GMV"] || 0,
      xlsx_live_gmv: xlsxRow["Live ECommerce GMV"] || 0,
      xlsx_total_gmv: xlsxRow["Total Livestream GMV"] || 0,
      xlsx_followers: xlsxRow["Followers"] || 0,
      xlsx_products: xlsxRow["Promoted Products"] || 0,
      xlsx_categories: xlsxRow["Creator Categories"] || "",
      found_in_api: !!apiData,
    };

    results.push(row);

    const status = apiData ? `GMV: $${gmvObj?.amount || 0} | Units: ${usr?.formatted_range || "-"}` : "NOT IN API";
    process.stdout.write(`[${i + 1}/${newHandles.length}] @${handle} - ${status}\n`);

    await new Promise(r => setTimeout(r, 350));
  }

  const foundCount = results.filter(r => r.found_in_api).length;
  console.log(`\n=== API matched: ${foundCount}/${results.length} ===\n`);

  // 5. Save CSV
  const today = new Date().toISOString().slice(0, 10);
  const csvHeader = "handle,profile_url,tiktok_gmv,avg_view,followers,units_sold_range,units_sold_min,xlsx_video_gmv,xlsx_live_gmv,xlsx_total_gmv,xlsx_followers,xlsx_products,xlsx_categories,created_date";
  const csvRows = results.map(r => {
    return [
      r.handle,
      `https://www.tiktok.com/@${r.handle}`,
      r.tiktok_gmv,
      r.avg_view,
      r.followers,
      r.units_sold_range,
      r.units_sold_min,
      r.xlsx_video_gmv,
      r.xlsx_live_gmv,
      r.xlsx_total_gmv,
      r.xlsx_followers,
      r.xlsx_products,
      `"${r.xlsx_categories}"`,
      today,
    ].join(",");
  });

  const csvPath = resolve(OUTPUT_DIR, `xlsx-enriched-${today}.csv`);
  writeFileSync(csvPath, csvHeader + "\n" + csvRows.join("\n"));
  console.log(`Saved CSV: ${csvPath}`);

  // Also save JSON for dedup tracking
  const jsonOutput = {
    date: today,
    source: "Ecommerce_Creators_20260323_140105.xlsx",
    total: results.length,
    duplicates_skipped: dupHandles.length,
    creators: results.map(r => ({ handle: r.handle })),
  };
  const jsonPath = resolve(OUTPUT_DIR, `xlsx-enriched-${today}.json`);
  writeFileSync(jsonPath, JSON.stringify(jsonOutput, null, 2));
  console.log(`Saved JSON: ${jsonPath}`);
}

main().catch(console.error);
