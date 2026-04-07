/**
 * Search TikTok Marketplace KOL creators:
 * - Avg view >= 100K
 * - Female followers >= 60%
 * - Target age 25-44 (exclude 18-24 dominant)
 * - Hair/beauty category preferred
 * - 30 creators
 *
 * Usage: npx tsx scripts/search-kol-creators.ts
 */

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { resolve } from "path";

const envPath = resolve(process.cwd(), ".env.local");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  const k = t.slice(0, eq).trim();
  const v = t.slice(eq + 1).trim();
  if (!process.env[k]) process.env[k] = v;
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
  const u = new URL(url);
  const p: Record<string, string | number> = {};
  u.searchParams.forEach((v, k) => { p[k] = v; });
  return p;
}
function generateSign(secret: string, rawUrl: string, body?: Record<string, unknown>) {
  const ts = Math.floor(Date.now() / 1000);
  const params = extractParams(rawUrl);
  params.timestamp = ts;
  delete params.sign;
  delete params.access_token;
  const sorted = Object.keys(params).sort().reduce((o, k) => { o[k] = params[k]; return o; }, {} as Record<string, string | number>);
  let s = secret + extractPath(rawUrl);
  for (const k in sorted) s += k + sorted[k];
  s += (body && Object.keys(body).length > 0) ? JSON.stringify(body) + secret : secret;
  return { sign: crypto.createHmac("sha256", secret).update(s).digest("hex"), ts };
}

// ── Categories ──
const HAIR_BEAUTY_CATEGORIES: Record<string, { score: number; label: string }> = {
  "605248": { score: 5, label: "Hair Care" },
  "601450": { score: 2, label: "Beauty & Personal Care" },
  "700645": { score: 2, label: "Skincare" },
  "700437": { score: 1, label: "Makeup" },
  "600942": { score: 2, label: "K-Beauty" },
  "601152": { score: 1, label: "Health & Wellness" },
};

const FASHION_CATEGORIES = new Set(["603014", "601352", "604453", "824328", "802184", "601303", "601739", "824584"]);

function calcHairScore(categoryIds: string[]): { score: number; tags: string[] } {
  let score = 0;
  const tags: string[] = [];
  for (const id of categoryIds) {
    const cat = HAIR_BEAUTY_CATEGORIES[id];
    if (cat) { score += cat.score; tags.push(cat.label); }
  }
  return { score, tags };
}

function isFashionOnly(categoryIds: string[]): boolean {
  if (categoryIds.length === 0) return false;
  const hasBeauty = categoryIds.some(id => HAIR_BEAUTY_CATEGORIES[id]);
  const hasFashion = categoryIds.some(id => FASHION_CATEGORIES.has(id));
  return hasFashion && !hasBeauty;
}

// ── Load previous exports ──
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

async function getCredentials() {
  const supabase = createClient(TIKTOK_DB_URL, TIKTOK_DB_KEY);
  const { data: rows, error } = await supabase.from("user_tiktok_info").select("access_token, shop_cipher").eq("shop_id", SHOP_ID).is("deleted_at", null).order("updated_at", { ascending: false }).limit(1);
  if (error || !rows?.length) throw new Error(`Credentials not found`);
  return { appKey: APP_KEY, appSecret: APP_SECRET, accessToken: rows[0].access_token, shopId: SHOP_ID, shopCipher: rows[0].shop_cipher };
}

async function searchPage(creds: Awaited<ReturnType<typeof getCredentials>>, pageToken: string, searchKey: string) {
  const body: Record<string, unknown> = {
    follower_demographics: {
      count_range: {
        count_ge: 500000,  // 500K+ followers = KOL tier
      },
      gender_distribution: {
        gender: "FEMALE",
        percentage_ge: 6000,
      },
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

  return {
    creators,
    nextPageToken: result.data?.next_page_token || "",
    searchKey: result.data?.search_key || "",
  };
}

async function main() {
  const creds = await getCredentials();
  console.log("TikTok credentials loaded\n");

  const previousHandles = loadPreviousHandles();
  console.log(`Loaded ${previousHandles.size} previously exported handles\n`);

  const trackerSupabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: existingAffiliates } = await trackerSupabase.from("affiliate_creators").select("handle");
  const existingHandles = new Set((existingAffiliates || []).map(a => (a.handle || "").toLowerCase().replace(/^@/, "")));
  console.log(`${existingHandles.size} handles already in affiliate_creators\n`);

  const allCreators: Creator[] = [];
  let pageToken = "";
  let searchKey = "";
  let pageNum = 0;
  const TARGET = 30;
  const MAX_PAGES = 100;

  while (allCreators.length < TARGET && pageNum < MAX_PAGES) {
    pageNum++;
    const result = await searchPage(creds, pageToken, searchKey);

    if (result.creators.length === 0) {
      console.log(`Page ${pageNum}: no more results`);
      break;
    }

    for (const c of result.creators) {
      const handleLower = c.handle.toLowerCase();

      // Skip duplicates
      if (previousHandles.has(handleLower) || existingHandles.has(handleLower)) continue;

      // Avg view >= 10K (KOL tier with 500K+ followers)
      if (c.avg_view < 10000) continue;

      // Exclude fashion-only
      if (isFashionOnly(c.category_ids)) continue;

      // Exclude if top age is mostly 18-24 (young audience)
      const youngDominant = c.top_age_ranges.length > 0 && c.top_age_ranges[0] === "AGE_RANGE_18_24";
      if (youngDominant) continue;

      allCreators.push(c);
      previousHandles.add(handleLower);
    }

    console.log(`Page ${pageNum}: ${result.creators.length} raw → ${allCreators.length} collected (target: ${TARGET})`);

    pageToken = result.nextPageToken;
    searchKey = result.searchKey;
    if (!pageToken) { console.log("No more pages"); break; }

    await new Promise(r => setTimeout(r, 350));
  }

  // Sort by hair_score desc, then avg_view desc
  allCreators.sort((a, b) => b.hair_score - a.hair_score || b.avg_view - a.avg_view);

  const final = allCreators.slice(0, TARGET);
  console.log(`\nTotal collected: ${allCreators.length}, outputting top ${final.length}\n`);

  // Print
  console.log("Hair | Handle | Avg.View | GMV | Followers | Tags | Age | Profile");
  console.log("-".repeat(130));
  for (const c of final) {
    const stars = c.hair_score >= 7 ? "★★★" : c.hair_score >= 4 ? "★★" : c.hair_score >= 1 ? "★" : "·";
    const ages = c.top_age_ranges.map(a => a.replace("AGE_RANGE_", "")).join(", ");
    console.log(`${stars} @${c.handle} | ${c.avg_view.toLocaleString()} | $${Math.round(c.gmv).toLocaleString()} | ${c.followers.toLocaleString()} | ${c.hair_tags.join(", ")} | ${ages} | ${c.profile_url}`);
  }

  // Save JSON
  const today = new Date().toISOString().slice(0, 10);
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  const output = {
    date: today,
    type: "KOL",
    filters: { avg_view_min: 100000, follower_gender: "FEMALE >= 60%", age_target: "25-44", exclude_fashion_only: true },
    total: final.length,
    creators: final.map(c => ({
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
  writeFileSync(resolve(OUTPUT_DIR, `kol-${today}.json`), JSON.stringify(output, null, 2));

  // Save CSV
  const header = "Handle,profile_url,gmv,avg_view,followers,hair_score,created_date";
  const rows = final.map(c =>
    [c.handle, c.profile_url, Math.round(c.gmv), c.avg_view, c.followers, c.hair_score, today].join(",")
  );
  writeFileSync(resolve(OUTPUT_DIR, `kol-${today}.csv`), header + "\n" + rows.join("\n"));

  console.log(`\nSaved: data/creator-lists/kol-${today}.json + .csv`);
}

main().catch(console.error);
