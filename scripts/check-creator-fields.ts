/**
 * Check all available fields from TikTok marketplace creator search API response
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

const APP_KEY = process.env.TIKTOK_APP_KEY!;
const APP_SECRET = process.env.TIKTOK_APP_SECRET!;
const SHOP_ID = process.env.TIKTOK_SHOP_ID!;
const TIKTOK_DB_URL = process.env.TIKTOK_DB_SUPABASE_URL!;
const TIKTOK_DB_KEY = process.env.TIKTOK_DB_SUPABASE_KEY!;

function extractPath(url: string): string { return new URL(url).pathname; }
function extractParams(url: string): Record<string, string | number> {
  const u = new URL(url); const p: Record<string, string | number> = {};
  u.searchParams.forEach((v, k) => { p[k] = v; }); return p;
}
function generateSign(secret: string, rawUrl: string, body?: Record<string, unknown>): { sign: string; ts: number } {
  const ts = Math.floor(Date.now() / 1000);
  const paramsObj = extractParams(rawUrl); paramsObj["timestamp"] = ts;
  delete paramsObj["sign"]; delete paramsObj["access_token"];
  const sorted = Object.keys(paramsObj).sort().reduce((o, k) => { o[k] = paramsObj[k]; return o; }, {} as Record<string, string | number>);
  let s = secret + extractPath(rawUrl);
  for (const key in sorted) s += key + sorted[key];
  s += (body && Object.keys(body).length > 0) ? JSON.stringify(body) + secret : secret;
  return { sign: crypto.createHmac("sha256", secret).update(s).digest("hex"), ts };
}

async function main() {
  const supabase = createClient(TIKTOK_DB_URL, TIKTOK_DB_KEY);
  const { data: rows } = await supabase.from("user_tiktok_info").select("access_token, shop_cipher").eq("shop_id", SHOP_ID).is("deleted_at", null).order("updated_at", { ascending: false }).limit(1);
  if (!rows?.length) throw new Error("No credentials");
  const creds = { appKey: APP_KEY, appSecret: APP_SECRET, accessToken: rows[0].access_token, shopId: SHOP_ID, shopCipher: rows[0].shop_cipher };

  const body: Record<string, unknown> = {
    gmv_ranges: ["GMV_RANGE_10000_AND_ABOVE"],
  };

  const qp = `page_size=12&app_key=${creds.appKey}&shop_id=${creds.shopId}&shop_cipher=${creds.shopCipher}&access_token=${creds.accessToken}`;
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
  if (result.code !== 0) { console.error("API error:", result); return; }

  const creators = result.data?.creators || [];
  if (creators.length === 0) { console.log("No creators"); return; }

  // Print all fields from first creator
  console.log("=== All fields from first creator ===\n");
  console.log(JSON.stringify(creators[0], null, 2));

  console.log("\n=== Top-level keys ===\n");
  console.log(Object.keys(creators[0]).join("\n"));
}

main().catch(console.error);
