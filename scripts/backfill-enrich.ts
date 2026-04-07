/**
 * Backfill script: affiliate_creators 중 gmv 또는 avg_view가 null인 레코드를 TikTok API로 채움
 *
 * Usage: npx tsx scripts/backfill-enrich.ts
 */

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

// ── Load env ────────────────────────────────────────────────────────────
import { readFileSync } from "fs";
import { resolve } from "path";

// Parse .env.local manually (no dotenv dependency)
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

const TRACKER_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const TRACKER_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const TIKTOK_DB_URL = process.env.TIKTOK_DB_SUPABASE_URL || TRACKER_URL;
const TIKTOK_DB_KEY = process.env.TIKTOK_DB_SUPABASE_KEY || TRACKER_KEY;

const APP_KEY = process.env.TIKTOK_APP_KEY!;
const APP_SECRET = process.env.TIKTOK_APP_SECRET!;
const SHOP_ID = process.env.TIKTOK_SHOP_ID!;

// ── TikTok API signing (copied from tiktok-api.ts) ─────────────────────

function extractPath(url: string): string {
  return new URL(url).pathname;
}

function extractParams(url: string): Record<string, string | number> {
  const urlObj = new URL(url);
  const params: Record<string, string | number> = {};
  urlObj.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

function objKeySort(obj: Record<string, string | number>): Record<string, string | number> {
  const sorted: Record<string, string | number> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return sorted;
}

function generateSign(
  secret: string,
  rawUrl: string,
  requestBody?: Record<string, unknown>
): { sign: string; ts: number } {
  const ts = Math.floor(Date.now() / 1000);
  const paramsObj = extractParams(rawUrl);
  paramsObj["timestamp"] = ts;
  delete paramsObj["sign"];
  delete paramsObj["access_token"];

  const sortedObj = objKeySort(paramsObj);
  let signString = secret + extractPath(rawUrl);
  for (const key in sortedObj) {
    signString += key + sortedObj[key];
  }

  if (requestBody && Object.keys(requestBody).length > 0) {
    signString += JSON.stringify(requestBody) + secret;
  } else {
    signString += secret;
  }

  const sign = crypto.createHmac("sha256", secret).update(signString).digest("hex");
  return { sign, ts };
}

// ── Get TikTok credentials ──────────────────────────────────────────────

async function getCredentials() {
  const supabase = createClient(TIKTOK_DB_URL, TIKTOK_DB_KEY);

  const { data: rows, error } = await supabase
    .from("user_tiktok_info")
    .select("access_token, shop_cipher, shop_id")
    .eq("shop_id", SHOP_ID)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error || !rows || rows.length === 0) {
    throw new Error(`Failed to fetch TikTok credentials: ${error?.message || "not found"}`);
  }

  return {
    appKey: APP_KEY,
    appSecret: APP_SECRET,
    accessToken: rows[0].access_token,
    shopId: SHOP_ID,
    shopCipher: rows[0].shop_cipher,
  };
}

// ── Search creator ──────────────────────────────────────────────────────

async function searchCreator(handle: string, creds: Awaited<ReturnType<typeof getCredentials>>) {
  const cleanHandle = handle.replace(/^@+/, "").trim();
  if (!cleanHandle) return null;

  const body = { keyword: cleanHandle };

  // Build signed URL
  let queryParams = `page_size=12&app_key=${creds.appKey}&shop_id=${creds.shopId}&shop_cipher=${creds.shopCipher}&access_token=${creds.accessToken}`;
  const baseUrl = "https://open-api.tiktokglobalshop.com/affiliate_seller/202508/marketplace_creators/search";
  const rawUrl = `${baseUrl}?${queryParams}`;
  const { sign, ts } = generateSign(creds.appSecret, rawUrl, body);
  const signedUrl = `${rawUrl}&sign=${sign}&timestamp=${ts}`;

  const response = await fetch(signedUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-tts-access-token": creds.accessToken,
    },
    body: JSON.stringify(body),
  });

  const result = await response.json();

  if (result.code !== 0 || !result.data?.creators?.length) {
    return null;
  }

  const creators = result.data.creators;
  const exactMatch = creators.find(
    (c: { username: string }) => c.username.toLowerCase() === cleanHandle.toLowerCase()
  );

  return exactMatch || creators[0];
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const tracker = createClient(TRACKER_URL, TRACKER_KEY);

  // 1. Find affiliates with null gmv or avg_view
  const { data: affiliates, error } = await tracker
    .from("affiliate_creators")
    .select("id, handle, gmv, avg_view")
    .or("gmv.is.null,avg_view.is.null");

  if (error) {
    console.error("DB query error:", error.message);
    process.exit(1);
  }

  if (!affiliates || affiliates.length === 0) {
    console.log("✅ No affiliates with empty GMV or avg_view. All good!");
    return;
  }

  console.log(`Found ${affiliates.length} affiliates to enrich\n`);

  // 2. Get TikTok credentials
  const creds = await getCredentials();
  console.log("TikTok credentials loaded\n");

  let enriched = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < affiliates.length; i++) {
    const a = affiliates[i];
    const prefix = `[${i + 1}/${affiliates.length}]`;

    if (!a.handle) {
      console.log(`${prefix} (no handle) — skipped`);
      skipped++;
      continue;
    }

    try {
      const creator = await searchCreator(a.handle, creds);

      if (!creator) {
        console.log(`${prefix} ${a.handle} — not found on TikTok`);
        skipped++;
        continue;
      }

      const updates: Record<string, unknown> = {};

      if (a.gmv == null && creator.gmv?.amount) {
        const gmv = parseFloat(creator.gmv.amount);
        if (!isNaN(gmv)) updates.gmv = gmv;
      }

      if (a.avg_view == null && creator.avg_ec_video_view_count != null) {
        updates.avg_view = creator.avg_ec_video_view_count;
      }

      if (creator.follower_count != null) {
        updates.followers = creator.follower_count;
      }

      if (Object.keys(updates).length === 0) {
        console.log(`${prefix} ${a.handle} — API returned no data for missing fields`);
        skipped++;
        continue;
      }

      updates.updated_at = new Date().toISOString();

      const { error: updateError } = await tracker
        .from("affiliate_creators")
        .update(updates)
        .eq("id", a.id);

      if (updateError) {
        console.log(`${prefix} ${a.handle} — DB update error: ${updateError.message}`);
        errors++;
      } else {
        const parts = [];
        if (updates.gmv != null) parts.push(`gmv=${updates.gmv}`);
        if (updates.avg_view != null) parts.push(`avg_view=${updates.avg_view}`);
        if (updates.followers != null) parts.push(`followers=${updates.followers}`);
        console.log(`${prefix} ${a.handle} — ✅ ${parts.join(", ")}`);
        enriched++;
      }
    } catch (err) {
      console.log(`${prefix} ${a.handle} — error: ${err}`);
      errors++;
    }

    // Rate limit
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\n=== Done ===`);
  console.log(`Enriched: ${enriched}`);
  console.log(`Skipped:  ${skipped}`);
  console.log(`Errors:   ${errors}`);
  console.log(`Total:    ${affiliates.length}`);
}

main().catch(console.error);
