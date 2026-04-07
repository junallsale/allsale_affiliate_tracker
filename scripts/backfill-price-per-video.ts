/**
 * Backfill price_per_video from price_comment (primary) or min_price (fallback)
 *
 * Usage: npx tsx scripts/backfill-price-per-video.ts
 *        npx tsx scripts/backfill-price-per-video.ts --dry-run
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
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

const DRY_RUN = process.argv.includes("--dry-run");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/**
 * Parse price_comment to extract per-video price.
 * Returns null if unable to determine.
 */
function parsePriceComment(comment: string): number | null {
  if (!comment || !comment.trim()) return null;

  const c = comment.trim();

  // Pattern: "$X per video" or "$X/video" or "$X / video"
  const perVideoMatch = c.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(?:per|\/|a)\s*(?:tiktok\s+(?:shop\s+)?)?video/i);
  if (perVideoMatch) {
    return parseNum(perVideoMatch[1]);
  }

  // Pattern: "$X per TikTok video" or "$X for 1 TikTok video"
  const perTiktokMatch = c.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(?:per|for\s+1)\s+(?:tiktok|TT)/i);
  if (perTiktokMatch) {
    return parseNum(perTiktokMatch[1]);
  }

  // Pattern: "1 video: $X" or "1 Video: $X" or "1 TikTok: $X"
  const oneVideoMatch = c.match(/1\s*(?:tiktok\s+)?(?:video|TikTok|post)\s*[:\-=]\s*\$\s*([\d,]+(?:\.\d+)?)/i);
  if (oneVideoMatch) {
    return parseNum(oneVideoMatch[1]);
  }

  // Pattern: "$X for 1 video"
  const forOneMatch = c.match(/\$\s*([\d,]+(?:\.\d+)?)\s+for\s+(?:1|one)\s+(?:tiktok\s+(?:shop\s+)?)?video/i);
  if (forOneMatch) {
    return parseNum(forOneMatch[1]);
  }

  // Pattern: "X videos for $Y" or "$Y for X videos" — calculate per video
  const bulkMatch1 = c.match(/(\d+)\s*videos?\s*(?:for|:)?\s*\$\s*([\d,]+(?:\.\d+)?)/i);
  if (bulkMatch1) {
    const count = parseInt(bulkMatch1[1]);
    const total = parseNum(bulkMatch1[2]);
    if (count > 0 && total) return Math.round(total / count);
  }

  const bulkMatch2 = c.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(?:for|\/)\s*(\d+)\s*videos?/i);
  if (bulkMatch2) {
    const total = parseNum(bulkMatch2[1]);
    const count = parseInt(bulkMatch2[2]);
    if (count > 0 && total) return Math.round(total / count);
  }

  // Pattern: "$X/month for Y videos" — calculate per video
  const monthlyMatch = c.match(/\$\s*([\d,]+(?:\.\d+)?)\s*\/?\s*(?:per\s+)?month\s+(?:for\s+)?(\d+)\s*(?:tiktok\s+(?:shop\s+)?)?videos?/i);
  if (monthlyMatch) {
    const monthly = parseNum(monthlyMatch[1]);
    const count = parseInt(monthlyMatch[2]);
    if (count > 0 && monthly) return Math.round(monthly / count);
  }

  // Pattern: "$X/month for Y videos" reversed
  const monthlyMatch2 = c.match(/(\d+)\s*(?:tiktok\s+(?:shop\s+)?)?videos?\s*.*?\$\s*([\d,]+(?:\.\d+)?)\s*\/?\s*(?:per\s+)?month/i);
  if (monthlyMatch2) {
    const count = parseInt(monthlyMatch2[1]);
    const monthly = parseNum(monthlyMatch2[2]);
    if (count > 0 && monthly) return Math.round(monthly / count);
  }

  // Pattern: simple "$X" with "rate" or "charge" or "fee" or "price" context (single amount = per video)
  const rateMatch = c.match(/(?:rate|charge|fee|price|flat\s+fee)\s+(?:is\s+|of\s+|starts?\s+at\s+)?\$\s*([\d,]+(?:\.\d+)?)/i);
  if (rateMatch) {
    return parseNum(rateMatch[1]);
  }

  // Pattern: "My rate is $X" or "I charge $X"
  const myRateMatch = c.match(/(?:my\s+rate\s+is|i\s+charge|i\s+currently\s+charge)\s+\$\s*([\d,]+(?:\.\d+)?)/i);
  if (myRateMatch) {
    return parseNum(myRateMatch[1]);
  }

  // Pattern: "$X/video" compact
  const compactMatch = c.match(/\$\s*([\d,]+(?:\.\d+)?)\s*\/\s*vid/i);
  if (compactMatch) {
    return parseNum(compactMatch[1]);
  }

  // Pattern: "$X/post"
  const postMatch = c.match(/\$\s*([\d,]+(?:\.\d+)?)\s*\/\s*post/i);
  if (postMatch) {
    return parseNum(postMatch[1]);
  }

  // Pattern: "비디오당 X" (Korean)
  const koreanMatch = c.match(/비디오당\s*\$?\s*([\d,]+)/);
  if (koreanMatch) {
    return parseNum(koreanMatch[1]);
  }

  // Pattern: "$X flat fee" (single video implied)
  const flatFeeMatch = c.match(/\$\s*([\d,]+(?:\.\d+)?)\s*flat\s*fee/i);
  if (flatFeeMatch) {
    return parseNum(flatFeeMatch[1]);
  }

  return null;
}

function parseNum(s: string): number | null {
  const n = parseFloat(s.replace(/,/g, ""));
  return isNaN(n) || n <= 0 ? null : n;
}

async function main() {
  const { data: affiliates, error } = await supabase
    .from("affiliate_creators")
    .select("id, handle, price_comment, min_price, price_per_video")
    .or("price_per_video.is.null,price_per_video.eq.0");

  if (error) {
    console.error("DB error:", error.message);
    process.exit(1);
  }

  if (!affiliates || affiliates.length === 0) {
    console.log("No affiliates need price_per_video update.");
    return;
  }

  console.log(`Found ${affiliates.length} affiliates without price_per_video`);
  if (DRY_RUN) console.log("(DRY RUN — no DB writes)\n");
  else console.log("");

  let fromComment = 0;
  let fromMinPrice = 0;
  let skipped = 0;
  let errors = 0;

  for (const a of affiliates) {
    const comment = a.price_comment?.trim() || "";
    const minPrice = a.min_price;

    // Try price_comment first
    let price = parsePriceComment(comment);
    let source = "comment";

    // Fallback to min_price
    if (price == null && minPrice && minPrice > 0) {
      price = minPrice;
      source = "min_price";
    }

    if (price == null) {
      skipped++;
      continue;
    }

    const prefix = source === "comment" ? "📝" : "💰";
    console.log(`${prefix} @${a.handle} → $${price}/video (from ${source})${comment ? ' | "' + comment.slice(0, 80) + (comment.length > 80 ? '...' : '') + '"' : ''}`);

    if (!DRY_RUN) {
      const { error: updateError } = await supabase
        .from("affiliate_creators")
        .update({ price_per_video: price, updated_at: new Date().toISOString() })
        .eq("id", a.id);

      if (updateError) {
        console.error(`  ❌ DB error: ${updateError.message}`);
        errors++;
        continue;
      }
    }

    if (source === "comment") fromComment++;
    else fromMinPrice++;
  }

  console.log(`\n=== Done${DRY_RUN ? " (DRY RUN)" : ""} ===`);
  console.log(`From price_comment: ${fromComment}`);
  console.log(`From min_price:     ${fromMinPrice}`);
  console.log(`Skipped (no data):  ${skipped}`);
  console.log(`Errors:             ${errors}`);
  console.log(`Total:              ${affiliates.length}`);
}

main().catch(console.error);
