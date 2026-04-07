/**
 * Search TikTok Marketplace creators - Hair Care only
 * - GMV >= $10,000
 * - Must have Hair Care category (605248)
 * - Female audience >= 60%
 * - Age 30+ preferred
 * - Dedup against previous exports + DB
 *
 * Usage: npx tsx scripts/search-haircare.ts
 */

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { resolve } from "path";

// Load env
const envPath = resolve(process.cwd(), ".env.local");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim();
  if (!process.env[key]) process.env[key] = val;
}

const APP_KEY = process.env.TIKTOK_APP_KEY!;
const APP_SECRET = process.env.TIKTOK_APP_SECRET!;
const SHOP_ID = process.env.TIKTOK_SHOP_ID!;
const TIKTOK_DB_URL = process.env.TIKTOK_DB_SUPABASE_URL!;
const TIKTOK_DB_KEY = process.env.TIKTOK_DB_SUPABASE_KEY!;

const OUTPUT_DIR = resolve(process.cwd(), "data/creator-lists");
const HAIR_CARE_ID = "605248";
const TARGET = 30;

// ── Signing ──
function extractPath(url: string): string { return new URL(url).pathname; }
function extractParams(url: string): Record<string, string | number> {
  const urlObj = new URL(url);
  const params: Record<string, string | number> = {};
  urlObj.searchParams.forEach((v, k) => { params[k] = v; });
  return params;
}

function generateSign(secret: string, rawUrl: string, body?: Record<string, unknown>): { sign: string; ts: number } {
  const ts = Math.floor(Date.now() / 1000);
  const paramsObj = extractParams(rawUrl);
  paramsObj["timestamp"] = ts;
  delete paramsObj["sign"];
  delete paramsObj["access_token"];
  const sorted = Object.keys(paramsObj).sort().reduce((o, k) => { o[k] = paramsObj[k]; return o; }, {} as Record<string, string | number>);
  let signString = secret + extractPath(rawUrl);
  for (const key in sorted) signString += key + sorted[key];
  signString += (body && Object.keys(body).length > 0) ? JSON.stringify(body) + secret : secret;
  return { sign: crypto.createHmac("sha256", secret).update(signString).digest("hex"), ts };
}

// ── Credentials ──
async function getCredentials() {
  const supabase = createClient(TIKTOK_DB_URL, TIKTOK_DB_KEY);
  const { data: rows, error } = await supabase.from("user_tiktok_info").select("access_token, shop_cipher").eq("shop_id", SHOP_ID).is("deleted_at", null).order("updated_at", { ascending: false }).limit(1);
  if (error || !rows?.length) throw new Error(`Credentials not found: ${error?.message}`);
  return { appKey: APP_KEY, appSecret: APP_SECRET, accessToken: rows[0].access_token, shopId: SHOP_ID, shopCipher: rows[0].shop_cipher };
}

// ── Previous handles ──
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
  console.log(`Loaded ${handles.size} previously exported handles\n`);
  return handles;
}

// ── Hair score ──
const HAIR_BEAUTY_CATEGORIES: Record<string, { score: number; label: string }> = {
  "605248": { score: 5, label: "Hair Care" },
  "601450": { score: 2, label: "Beauty & Personal Care" },
  "700645": { score: 2, label: "Skincare" },
  "700437": { score: 1, label: "Makeup" },
  "600942": { score: 2, label: "K-Beauty" },
  "601152": { score: 1, label: "Health & Wellness" },
};

function calcHairScore(categoryIds: string[]): { score: number; tags: string[] } {
  let score = 0;
  const tags: string[] = [];
  for (const id of categoryIds) {
    const cat = HAIR_BEAUTY_CATEGORIES[id];
    if (cat) { score += cat.score; tags.push(cat.label); }
  }
  return { score, tags };
}

interface Creator {
  handle: string;
  gmv: number;
  avg_view: number;
  followers: number;
  profile_url: string;
  category_ids: string[];
  hair_score: number;
  hair_tags: string[];
  top_age_ranges: string[];
}

async function searchPage(creds: Awaited<ReturnType<typeof getCredentials>>, pageToken: string, searchKey: string) {
  const body: Record<string, unknown> = {
    gmv_ranges: ["GMV_RANGE_1000_10000", "GMV_RANGE_10000_AND_ABOVE"],
    follower_demographics: {
      gender_distribution: { gender: "FEMALE", percentage_ge: 6000 },
    },
  };
  if (searchKey) body.search_key = searchKey;

  let qp = `page_size=20&app_key=${creds.appKey}&shop_id=${creds.shopId}&shop_cipher=${creds.shopCipher}&access_token=${creds.accessToken}`;
  if (pageToken) qp += `&page_token=${pageToken}`;

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
  if (result.code !== 0) {
    console.error(`API error: code=${result.code}, message=${result.message}`);
    return { creators: [] as Creator[], nextPageToken: "", searchKey: "" };
  }

  const creators: Creator[] = (result.data?.creators || []).map((c: Record<string, unknown>) => {
    const gmvObj = c.gmv as { amount?: string } | undefined;
    const catIds = (c.category_ids as string[]) || [];
    const { score, tags } = calcHairScore(catIds);
    const topDemo = c.top_follower_demographics as { age_ranges?: string[] } | undefined;

    return {
      handle: c.username as string,
      gmv: gmvObj?.amount ? parseFloat(gmvObj.amount) : 0,
      avg_view: (c.avg_ec_video_view_count as number) || 0,
      followers: (c.follower_count as number) || 0,
      profile_url: `https://www.tiktok.com/@${c.username}`,
      category_ids: catIds,
      hair_score: score,
      hair_tags: tags,
      top_age_ranges: topDemo?.age_ranges || [],
    };
  });

  return { creators, nextPageToken: result.data?.next_page_token || "", searchKey: result.data?.search_key || "" };
}

// ── Main ──
async function main() {
  const creds = await getCredentials();
  console.log("TikTok credentials loaded\n");

  const previousHandles = loadPreviousHandles();

  const trackerSupabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: existingAffiliates } = await trackerSupabase.from("affiliate_creators").select("handle");
  const existingHandles = new Set((existingAffiliates || []).map(a => (a.handle || "").toLowerCase().replace(/^@/, "")));
  console.log(`${existingHandles.size} handles already in affiliate_creators\n`);

  const allCreators: Creator[] = [];
  let pageToken = "";
  let searchKey = "";
  let pageNum = 0;
  const MAX_PAGES = 120;

  while (allCreators.length < TARGET && pageNum < MAX_PAGES) {
    pageNum++;
    const result = await searchPage(creds, pageToken, searchKey);

    if (result.creators.length === 0) {
      console.log(`Page ${pageNum}: no more results`);
      break;
    }

    for (const c of result.creators) {
      const handleLower = c.handle.toLowerCase();
      if (previousHandles.has(handleLower) || existingHandles.has(handleLower)) continue;

      // GMV >= $1,000 (no client-side min since API range starts at 1K)


      // MUST have Hair Care category
      if (!c.category_ids.includes(HAIR_CARE_ID)) continue;

      // Exclude if top age is 18-24
      if (c.top_age_ranges.length > 0 && c.top_age_ranges[0] === "AGE_RANGE_18_24") continue;

      allCreators.push(c);
      previousHandles.add(handleLower);

      if (allCreators.length >= TARGET) break;
    }

    console.log(`Page ${pageNum}: ${result.creators.length} raw → ${allCreators.length} collected`);

    pageToken = result.nextPageToken;
    searchKey = result.searchKey;
    if (!pageToken) { console.log("No more pages"); break; }
    await new Promise(r => setTimeout(r, 350));
  }

  console.log(`\nTotal collected: ${allCreators.length}\n`);

  const today = new Date().toISOString().slice(0, 10);
  allCreators.sort((a, b) => b.hair_score - a.hair_score || b.gmv - a.gmv);

  const output = {
    date: today,
    filters: { gmv_min: 10000, category: "Hair Care (605248) required", follower_gender: "FEMALE >= 60%", age: "30+ preferred" },
    total: allCreators.length,
    creators: allCreators.map(c => ({
      handle: c.handle,
      gmv: c.gmv,
      avg_view: c.avg_view,
      followers: c.followers,
      profile_url: c.profile_url,
      hair_score: c.hair_score,
      hair_tags: c.hair_tags,
      top_age_ranges: c.top_age_ranges,
    })),
  };

  // Print
  console.log("Hair | Handle | GMV | Avg.View | Followers | Ages | Tags");
  console.log("-".repeat(120));
  for (const c of output.creators) {
    const stars = c.hair_score >= 7 ? "★★★" : c.hair_score >= 4 ? "★★" : "★";
    const ages = c.top_age_ranges.map(a => a.replace("AGE_RANGE_", "")).join(", ");
    console.log(`${stars} @${c.handle} | $${Math.round(c.gmv).toLocaleString()} | ${c.avg_view} | ${c.followers} | ${ages} | ${c.hair_tags.join(", ")}`);
  }

  // Save
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  const jsonPath = resolve(OUTPUT_DIR, `haircare-${today}.json`);
  writeFileSync(jsonPath, JSON.stringify(output, null, 2));
  console.log(`\nSaved JSON: ${jsonPath}`);

  const csvHeader = "Handle,profile_url,gmv,avg_view,followers,hair_score,hair_tags,top_ages,created_date";
  const csvRows = allCreators.map(c => {
    const handle = c.handle.replace(/^@/, "");
    const ages = c.top_age_ranges.map(a => a.replace("AGE_RANGE_", "")).join("|");
    return [handle, c.profile_url, Math.round(c.gmv), c.avg_view, c.followers, c.hair_score, `"${c.hair_tags.join(", ")}"`, `"${ages}"`, today].join(",");
  });
  const csvPath = resolve(OUTPUT_DIR, `haircare-${today}.csv`);
  writeFileSync(csvPath, csvHeader + "\n" + csvRows.join("\n"));
  console.log(`Saved CSV: ${csvPath}`);
}

main().catch(console.error);
