/**
 * Backfill tier for creator_master rows that have price_per_video + avg_view but tier IS NULL
 * Usage: npx tsx scripts/backfill-tier.ts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { calculateTier } from "../src/lib/pricing";

const envPath = resolve(process.cwd(), ".env.local");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  if (!process.env[t.slice(0, eq).trim()]) process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Find rows with price_per_video + avg_view but no tier
  const { data: rows, error } = await supabase
    .from("creator_master")
    .select("id, handle, price_per_video, avg_view, gmv, tier")
    .is("tier", null)
    .not("price_per_video", "is", null)
    .not("avg_view", "is", null)
    .order("created_at", { ascending: false });

  if (error) { console.error("Fetch error:", error); return; }
  if (!rows?.length) { console.log("No rows to backfill."); return; }

  console.log(`Found ${rows.length} creators with null tier to backfill\n`);

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const tier = calculateTier(
      Number(row.price_per_video),
      Number(row.avg_view),
      Number(row.gmv) || 0
    );

    if (tier === null) {
      skipped++;
      continue;
    }

    const { error: updateErr } = await supabase
      .from("creator_master")
      .update({ tier, updated_at: new Date().toISOString() })
      .eq("id", row.id);

    if (updateErr) {
      console.error(`  Error updating @${row.handle}:`, updateErr.message);
      skipped++;
    } else {
      updated++;
      console.log(`  @${row.handle} → tier ${tier} (ppv: $${row.price_per_video}, avg_view: ${row.avg_view}, gmv: $${row.gmv || 0})`);
    }
  }

  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`);
}

main().catch(console.error);
