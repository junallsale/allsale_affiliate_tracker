/**
 * Enrich creator_master price data from allsale inbox messages.
 * Reads INBOUND email replies from prod allsale DB, uses OpenAI to extract
 * price_per_video + price_comment, then writes to tracker DB.
 *
 * Usage:
 *   npx tsx scripts/enrich-inbox-price.ts             # live run
 *   npx tsx scripts/enrich-inbox-price.ts --dry-run   # preview only
 *
 * Parallel batch size: 5 creators at a time
 */
import { createClient } from "@supabase/supabase-js";
import { Pool as PgPool } from "pg";
import OpenAI from "openai";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Load .env.local ──────────────────────────────────────────────────────────
const envPath = resolve(process.cwd(), ".env.local");
for (const line of readFileSync(envPath, "utf-8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  if (!process.env[t.slice(0, eq).trim()])
    process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
}

const isDryRun = process.argv.includes("--dry-run");
const BATCH = 5;

// ── Clients ──────────────────────────────────────────────────────────────────
const trackerDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Direct PG pool to prod allsale DB (bypasses RLS, supports parallel queries)
const prodPg = new PgPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || "5432"),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false },
  max: 10,
});

const openai = new OpenAI({ apiKey: process.env.OPEN_AI_KEY });

// ── Helpers ───────────────────────────────────────────────────────────────────
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function extractPrice(handle: string, messages: { direction: string; subject: string; text: string; sent_at: string }[]): Promise<{ price_per_video: number | null; price_comment: string | null }> {
  const thread = messages
    .map(m => `[${m.direction}][${m.sent_at.slice(0, 10)}] Subject: ${m.subject}\n${m.text.slice(0, 1500)}`)
    .join("\n\n---\n\n");

  const prompt = `You are analyzing an email thread between a TikTok affiliate agency (ALLSALE) and a creator (@${handle}).
Extract the creator's quoted price per TikTok video (single video rate in USD).

Rules:
- Only extract INBOUND messages (creator's replies)
- If multiple prices quoted (bundle deals), calculate and use the single-video rate
- If no clear price found, return null for both fields
- price_comment should be a concise English note (max 100 chars) summarizing the rate structure

Email thread:
${thread}

Respond ONLY with valid JSON:
{"price_per_video": <number or null>, "price_comment": "<string or null>"}`;

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      response_format: { type: "json_object" },
      max_tokens: 100,
    });
    const raw = resp.choices[0].message.content || "{}";
    const parsed = JSON.parse(raw);
    return {
      price_per_video: parsed.price_per_video ?? null,
      price_comment: parsed.price_comment ?? null,
    };
  } catch (err) {
    console.error(`  OpenAI error for @${handle}:`, err);
    return { price_per_video: null, price_comment: null };
  }
}

async function processCreator(row: { id: string; handle: string }): Promise<"updated" | "no_price" | "no_inbox" | "error"> {
  try {
    // Fetch inbox messages from prod allsale DB
    const { rows: msgs } = await prodPg.query<{
      direction: string; subject: string; message: string; message_at: string;
    }>(
      `SELECT inbox.direction, inbox.subject, inbox.message, inbox.message_at::text
       FROM tiktok_creator_info tci
       JOIN tiktok_creator_inbox inbox ON inbox.tiktok_creator_info_id = tci.id
       WHERE LOWER(tci.unique_id) = $1
       ORDER BY inbox.message_at ASC`,
      [row.handle.toLowerCase()]
    );

    if (!msgs.length) return "no_inbox";

    const messages = msgs.map(m => ({
      direction: m.direction,
      subject: m.subject || "",
      text: stripHtml(m.message || ""),
      sent_at: m.message_at,
    }));

    const { price_per_video, price_comment } = await extractPrice(row.handle, messages);

    if (!price_per_video) return "no_price";

    if (isDryRun) {
      process.stdout.write(
        `  [DRY RUN] @${row.handle} → $${price_per_video}${price_comment ? ` | "${price_comment}"` : ""}\n`
      );
      return "updated";
    }

    // Update creator_master
    await trackerDb.from("creator_master").update({
      price_per_video,
      price_comment,
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);

    // Upsert pricing history
    await trackerDb.from("creator_pricing_history").upsert({
      creator_master_id: row.id,
      recorded_at: new Date().toISOString().split("T")[0],
      price_per_video,
      price_comment,
      source: "inbox_ai",
    }, { onConflict: "creator_master_id,recorded_at" });

    process.stdout.write(
      `  ✓ @${row.handle} → $${price_per_video}${price_comment ? ` | "${price_comment}"` : ""}\n`
    );
    return "updated";
  } catch (err) {
    console.error(`  ERROR @${row.handle}:`, err);
    return "error";
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // Verify connection
  await prodPg.query("SELECT 1");
  console.log(`Connected to prod allsale DB\n`);

  // Fetch all creator_master records missing price
  const { data: creators, error } = await trackerDb
    .from("creator_master")
    .select("id, handle")
    .is("price_per_video", null)
    .order("updated_at", { ascending: false });

  if (error || !creators) { console.error("Failed to fetch creator_master:", error); return; }
  console.log(`${creators.length} creators with no price_per_video${isDryRun ? " (DRY RUN)" : ""}\n`);

  const stats = { updated: 0, no_price: 0, no_inbox: 0, error: 0 };

  // Process in parallel batches
  for (let i = 0; i < creators.length; i += BATCH) {
    const batch = creators.slice(i, i + BATCH);
    const label = `[${i + 1}–${Math.min(i + BATCH, creators.length)}/${creators.length}]`;
    process.stdout.write(`\n${label} Processing batch...\n`);

    const results = await Promise.all(batch.map(c => processCreator(c)));
    results.forEach(r => stats[r]++);

    // Small pause between batches to respect rate limits
    if (i + BATCH < creators.length) await new Promise(r => setTimeout(r, 500));
  }

  await prodPg.end();

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Done${isDryRun ? " (dry run)" : ""}`);
  console.log(`  Updated : ${stats.updated}`);
  console.log(`  No price in inbox : ${stats.no_price}`);
  console.log(`  No inbox messages : ${stats.no_inbox}`);
  console.log(`  Errors   : ${stats.error}`);
}

main().catch(console.error);
