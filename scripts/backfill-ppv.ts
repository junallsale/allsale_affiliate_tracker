/**
 * Backfill price_per_video and price_comment for creator_master records where those are null.
 * Checks affiliate_creators by handle, takes highest price_per_video per creator.
 *
 * Usage: npx tsx scripts/backfill-ppv.ts
 *        npx tsx scripts/backfill-ppv.ts --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

const envPath = resolve(process.cwd(), ".env.local");
for (const line of readFileSync(envPath, "utf-8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  if (!process.env[t.slice(0, eq).trim()]) process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
}

const isDryRun = process.argv.includes("--dry-run");

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Fetch creator_master records missing price_per_video
  const { data: masters, error: mErr } = await supabase
    .from("creator_master")
    .select("id, handle, price_per_video, price_comment")
    .is("price_per_video", null);

  if (mErr) { console.error("Error fetching creator_master:", mErr); return; }
  if (!masters?.length) { console.log("All creators already have price_per_video. Nothing to backfill."); return; }

  console.log(`Found ${masters.length} creators missing price_per_video\n`);

  // Fetch all affiliate_creators that have price_per_video
  const handles = masters.map(m => m.handle);
  const { data: affiliates, error: aErr } = await supabase
    .from("affiliate_creators")
    .select("handle, price_per_video, price_comment")
    .in("handle", handles)
    .not("price_per_video", "is", null)
    .order("price_per_video", { ascending: false });

  if (aErr) { console.error("Error fetching affiliate_creators:", aErr); return; }

  // Also try with @ prefix variant
  const handlesAtSign = handles.map(h => `@${h}`);
  const { data: affiliatesAt } = await supabase
    .from("affiliate_creators")
    .select("handle, price_per_video, price_comment")
    .in("handle", handlesAtSign)
    .not("price_per_video", "is", null)
    .order("price_per_video", { ascending: false });

  const allAffiliates = [...(affiliates || []), ...(affiliatesAt || [])];

  // Build map: handle → best (highest) price_per_video entry
  const bestPriceMap = new Map<string, { price_per_video: number; price_comment: string | null }>();
  for (const ac of allAffiliates) {
    const cleanHandle = (ac.handle || '').replace(/^@+/, '').toLowerCase();
    const existing = bestPriceMap.get(cleanHandle);
    const ppv = Number(ac.price_per_video);
    if (!existing || ppv > existing.price_per_video) {
      bestPriceMap.set(cleanHandle, { price_per_video: ppv, price_comment: ac.price_comment || null });
    }
  }

  console.log(`Found price data in affiliate_creators for ${bestPriceMap.size} unique handles\n`);

  let updated = 0, skipped = 0;

  for (const master of masters) {
    const match = bestPriceMap.get(master.handle.toLowerCase());
    if (!match) {
      process.stdout.write(`[@${master.handle}] No match in affiliate_creators → skipped\n`);
      skipped++;
      continue;
    }

    const line = `[@${master.handle}] price_per_video: $${Math.round(match.price_per_video)}${match.price_comment ? ` | comment: "${match.price_comment}"` : ''}`;

    if (isDryRun) {
      process.stdout.write(`[DRY RUN] ${line}\n`);
      updated++;
      continue;
    }

    const { error: uErr } = await supabase
      .from("creator_master")
      .update({
        price_per_video: match.price_per_video,
        price_comment: match.price_comment,
        updated_at: new Date().toISOString(),
      })
      .eq("id", master.id);

    if (uErr) {
      process.stdout.write(`[@${master.handle}] ERROR: ${uErr.message}\n`);
    } else {
      process.stdout.write(`${line} ✓\n`);
      updated++;
    }
  }

  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}${isDryRun ? ' (dry run — no changes made)' : ''}`);
}

main().catch(console.error);
