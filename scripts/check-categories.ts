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

async function main() {
  const supabase = createClient(process.env.TIKTOK_DB_SUPABASE_URL!, process.env.TIKTOK_DB_SUPABASE_KEY!);
  const { data: rows } = await supabase.from("user_tiktok_info").select("access_token, shop_cipher").eq("shop_id", process.env.TIKTOK_SHOP_ID!).is("deleted_at", null).order("updated_at", { ascending: false }).limit(1);
  if (!rows?.length) throw new Error("No creds");
  const creds = { appKey: process.env.TIKTOK_APP_KEY!, appSecret: process.env.TIKTOK_APP_SECRET!, accessToken: rows[0].access_token, shopId: process.env.TIKTOK_SHOP_ID!, shopCipher: rows[0].shop_cipher };

  // Search multiple pages to gather category_ids
  const catMap: Record<string, number> = {};
  const samples: Record<string, string[]> = {};
  let pageToken = "";
  let searchKey = "";

  for (let p = 0; p < 5; p++) {
    const body: Record<string, unknown> = {
      gmv_ranges: ["GMV_RANGE_10000_AND_ABOVE"],
      follower_demographics: { gender_distribution: { gender: "FEMALE", percentage_ge: 6000 } },
    };
    if (searchKey) body.search_key = searchKey;

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
    const result = await res.json();
    if (result.code !== 0) { console.error(result); break; }

    for (const c of result.data?.creators || []) {
      for (const cat of c.category_ids || []) {
        catMap[cat] = (catMap[cat] || 0) + 1;
        if (!samples[cat]) samples[cat] = [];
        if (samples[cat].length < 3) samples[cat].push(c.username);
      }
    }

    pageToken = result.data?.next_page_token || "";
    searchKey = result.data?.search_key || "";
    if (!pageToken) break;
    await new Promise(r => setTimeout(r, 350));
  }

  console.log("Category ID frequencies (from 100 creators):\n");
  const sorted = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
  for (const [cat, count] of sorted) {
    console.log(`${cat}: ${count} creators  (e.g. ${samples[cat]?.join(", ")})`);
  }
}

main().catch(console.error);
