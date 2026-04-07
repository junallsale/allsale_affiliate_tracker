import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const OUTPUT_DIR = resolve(process.cwd(), "data/creator-lists");

async function main() {
  // Find project ID
  const { data: projects } = await supabase.from("projects").select("id, name").ilike("name", "%2603_Paid%");
  if (!projects || projects.length === 0) {
    console.error("Project '2603_Paid' not found");
    return;
  }
  const projectId = projects[0].id;
  console.log(`Project: ${projects[0].name} (${projectId})\n`);

  // Get affiliates matching DF_paid view filters
  const { data, error } = await supabase
    .from("affiliate_creators")
    .select("id, handle, gmv, avg_view, followers, tier, price_per_video, min_price, status")
    .eq("status", "Rate Received")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error:", error.message);
    return;
  }
  if (!data || data.length === 0) {
    console.log("No affiliates found");
    return;
  }

  console.log(`Found ${data.length} affiliates\n`);

  // Load previous exports for dedup check
  const previousHandles = new Set<string>();
  if (existsSync(OUTPUT_DIR)) {
    for (const file of readdirSync(OUTPUT_DIR)) {
      if (!file.endsWith(".json")) continue;
      try {
        const d = JSON.parse(readFileSync(resolve(OUTPUT_DIR, file), "utf-8"));
        for (const c of d.creators || []) {
          if (c.handle) previousHandles.add(c.handle.toLowerCase());
        }
      } catch { /* skip */ }
    }
  }
  console.log(`${previousHandles.size} handles in previous exports\n`);

  // Check duplicates
  const duplicates: string[] = [];
  const unique: typeof data = [];
  for (const a of data) {
    const h = (a.handle || "").toLowerCase().replace(/^@/, "");
    if (previousHandles.has(h)) {
      duplicates.push(a.handle);
    } else {
      unique.push(a);
    }
  }

  if (duplicates.length > 0) {
    console.log(`Duplicates found (${duplicates.length}): ${duplicates.join(", ")}`);
  } else {
    console.log("No duplicates found");
  }
  console.log(`Unique to export: ${unique.length}\n`);

  // Generate CSV
  const today = new Date().toISOString().slice(0, 10);
  const header = "Handle,profile_url,gmv,avg_view,followers,hair_score,created_date,price";
  const rows = unique.map(a => {
    const handle = (a.handle || "").replace(/^@/, "");
    const price = a.price_per_video || a.min_price || 0;
    return [
      handle,
      `https://www.tiktok.com/@${handle}`,
      Math.round(a.gmv || 0),
      a.avg_view || 0,
      a.followers || 0,
      a.tier || 0,
      today,
      price,
    ].join(",");
  });

  const csv = header + "\n" + rows.join("\n");
  const csvPath = resolve(OUTPUT_DIR, `df-paid-${today}.csv`);
  writeFileSync(csvPath, csv);
  console.log(`Saved: ${csvPath}\n`);

  // Print
  console.log(header);
  rows.forEach(r => console.log(r));

  // Update status to Confirm Req
  const ids = unique.map(a => a.id);
  if (ids.length > 0) {
    const { data: updated, error: updateError } = await supabase
      .from("affiliate_creators")
      .update({ status: "Confirm Req", updated_at: new Date().toISOString() })
      .in("id", ids)
      .select("handle, status");

    if (updateError) {
      console.error("\nStatus update error:", updateError.message);
    } else {
      console.log(`\nUpdated ${updated?.length} creators to 'Confirm Req'`);
    }
  }
}

main().catch(console.error);
