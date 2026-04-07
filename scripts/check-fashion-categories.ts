/**
 * Identify fashion-related category IDs from TikTok Marketplace API
 * by searching with fashion keywords and collecting category patterns
 */

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
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

async function searchPage(creds: { appKey: string; appSecret: string; accessToken: string; shopId: string; shopCipher: string }, body: Record<string, unknown>, pageToken: string) {
  let qp = `page_size=20&app_key=${creds.appKey}&shop_id=${creds.shopId}&shop_cipher=${creds.shopCipher}&access_token=${creds.accessToken}`;
  if (pageToken) qp += `&page_token=${pageToken}`;
  const rawUrl = `https://open-api.tiktokglobalshop.com/affiliate_seller/202508/marketplace_creators/search?${qp}`;
  const { sign, ts } = generateSign(creds.appSecret, rawUrl, body);
  const signedUrl = `${rawUrl}&sign=${sign}&timestamp=${ts}`;

  const res = await fetch(signedUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-tts-access-token": creds.accessToken },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function main() {
  const supabase = createClient(process.env.TIKTOK_DB_SUPABASE_URL!, process.env.TIKTOK_DB_SUPABASE_KEY!);
  const { data: rows } = await supabase.from("user_tiktok_info").select("access_token, shop_cipher").eq("shop_id", process.env.TIKTOK_SHOP_ID!).is("deleted_at", null).order("updated_at", { ascending: false }).limit(1);
  if (!rows?.length) throw new Error("No creds");
  const creds = { appKey: process.env.TIKTOK_APP_KEY!, appSecret: process.env.TIKTOK_APP_SECRET!, accessToken: rows[0].access_token, shopId: process.env.TIKTOK_SHOP_ID!, shopCipher: rows[0].shop_cipher };

  // Search with different keywords to map category IDs
  const keywords = ["fashion", "clothing", "dress", "outfit"];
  const catCreators: Record<string, { count: number; creators: string[]; keywords: Set<string> }> = {};

  for (const kw of keywords) {
    console.log(`\nSearching keyword: "${kw}"`);
    const body: Record<string, unknown> = { keyword: kw, gmv_ranges: ["GMV_RANGE_10000_AND_ABOVE"] };

    for (let p = 0; p < 3; p++) {
      const result = await searchPage(creds, body, "");
      if (result.code !== 0 || !result.data?.creators?.length) break;

      for (const c of result.data.creators) {
        for (const cat of c.category_ids || []) {
          if (!catCreators[cat]) catCreators[cat] = { count: 0, creators: [], keywords: new Set() };
          catCreators[cat].count++;
          catCreators[cat].keywords.add(kw);
          if (catCreators[cat].creators.length < 3) catCreators[cat].creators.push(c.username);
        }
      }
      break; // one page per keyword is enough
    }
    await new Promise(r => setTimeout(r, 350));
  }

  // Also search beauty-only to compare
  console.log(`\nSearching keyword: "beauty skincare"`);
  const beautyBody: Record<string, unknown> = { keyword: "skincare", gmv_ranges: ["GMV_RANGE_10000_AND_ABOVE"] };
  const beautyResult = await searchPage(creds, beautyBody, "");
  const beautyCats = new Set<string>();
  if (beautyResult.data?.creators) {
    for (const c of beautyResult.data.creators) {
      for (const cat of c.category_ids || []) beautyCats.add(cat);
    }
  }

  // Now also get categories from the 0-score creators in our list to see what they have
  console.log("\n\nSearching 0-score creators individually to identify their categories...");
  const zeroScoreHandles = ["that.one.girl_erin", "jp.field.tested", "sarahgibbons_", "highland.fashion7", "allure_fashion", "chaosonthecoast_", "xdallas_333"];

  for (const handle of zeroScoreHandles) {
    const body: Record<string, unknown> = { keyword: handle };
    const result = await searchPage(creds, body, "");
    if (result.data?.creators?.length) {
      const match = result.data.creators.find((c: { username: string }) => c.username.toLowerCase() === handle.toLowerCase()) || result.data.creators[0];
      console.log(`@${match.username}: categories=${(match.category_ids || []).join(", ")}`);
    }
    await new Promise(r => setTimeout(r, 350));
  }

  console.log("\n=== Category Summary ===\n");
  const sorted = Object.entries(catCreators).sort((a, b) => b[1].count - a[1].count);
  for (const [cat, info] of sorted) {
    const inBeauty = beautyCats.has(cat) ? " (also in beauty)" : "";
    console.log(`${cat}: ${info.count} hits | keywords: ${[...info.keywords].join(",")} | e.g. ${info.creators.join(", ")}${inBeauty}`);
  }
}

main().catch(console.error);
