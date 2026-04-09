/**
 * Import campaign 818 replied creators into creator_master.
 *
 * Flow:
 *   1. Query campaign replied emails from prod DB (brand schema)
 *   2. Use OpenAI to extract price_per_video + price_comment
 *   3. Check existing creator_master in tracker DB
 *   4. New creators: insert creator_master + pricing_history
 *   5. Existing creators: add pricing_history only
 *   6. Enrich all with TikTok API (GMV, avg_view, followers)
 *
 * Usage:
 *   npx tsx scripts/import-campaign-replies.ts                    # live run
 *   npx tsx scripts/import-campaign-replies.ts --dry-run          # preview
 *   npx tsx scripts/import-campaign-replies.ts --campaign-id=818  # specific campaign
 *   npx tsx scripts/import-campaign-replies.ts --skip-enrich      # skip TikTok API
 */
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { Pool as PgPool } from "pg";
import OpenAI from "openai";
import { readFileSync } from "fs";
import { resolve } from "path";
import { calculateTier } from "../src/lib/pricing";

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

// ── Args ─────────────────────────────────────────────────────────────────────
const isDryRun = process.argv.includes("--dry-run");
const skipEnrich = process.argv.includes("--skip-enrich");
const campaignIdArg = process.argv.find((a) => a.startsWith("--campaign-id="));
const CAMPAIGN_ID = campaignIdArg
  ? parseInt(campaignIdArg.split("=")[1])
  : 818;
const BATCH = 5;

// ── Clients ──────────────────────────────────────────────────────────────────
const trackerDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

// ── TikTok API Setup ─────────────────────────────────────────────────────────
const APP_KEY = process.env.TIKTOK_APP_KEY!;
const APP_SECRET = process.env.TIKTOK_APP_SECRET!;
const SHOP_ID = process.env.TIKTOK_SHOP_ID!;

function extractPath(url: string) {
  return new URL(url).pathname;
}
function extractParams(url: string) {
  const u = new URL(url);
  const p: Record<string, string | number> = {};
  u.searchParams.forEach((v, k) => {
    p[k] = v;
  });
  return p;
}
function generateSign(
  secret: string,
  rawUrl: string,
  body?: Record<string, unknown>
) {
  const ts = Math.floor(Date.now() / 1000);
  const paramsObj = extractParams(rawUrl);
  paramsObj["timestamp"] = ts;
  delete paramsObj["sign"];
  delete paramsObj["access_token"];
  const sorted = Object.keys(paramsObj)
    .sort()
    .reduce((o, k) => {
      o[k] = paramsObj[k];
      return o;
    }, {} as Record<string, string | number>);
  let s = secret + extractPath(rawUrl);
  for (const key in sorted) s += key + sorted[key];
  s +=
    body && Object.keys(body).length > 0
      ? JSON.stringify(body) + secret
      : secret;
  return {
    sign: crypto.createHmac("sha256", secret).update(s).digest("hex"),
    ts,
  };
}

let tikTokCreds: {
  appKey: string;
  appSecret: string;
  accessToken: string;
  shopId: string;
  shopCipher: string;
} | null = null;

async function getTikTokCreds() {
  if (tikTokCreds) return tikTokCreds;
  const tikDb = createClient(
    process.env.TIKTOK_DB_SUPABASE_URL!,
    process.env.TIKTOK_DB_SUPABASE_KEY!
  );
  const { data: rows } = await tikDb
    .from("user_tiktok_info")
    .select("access_token, shop_cipher")
    .eq("shop_id", SHOP_ID)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (!rows?.length) throw new Error("No TikTok credentials found");
  tikTokCreds = {
    appKey: APP_KEY,
    appSecret: APP_SECRET,
    accessToken: rows[0].access_token,
    shopId: SHOP_ID,
    shopCipher: rows[0].shop_cipher,
  };
  return tikTokCreds;
}

async function enrichFromTikTok(
  handle: string
): Promise<{ gmv: number | null; avg_view: number | null; followers: number | null } | null> {
  try {
    const creds = await getTikTokCreds();
    const cleanHandle = handle.replace(/^@+/, "").trim();
    if (!cleanHandle) return null;

    const body = { keyword: cleanHandle };
    const baseUrl =
      "https://open-api.tiktokglobalshop.com/affiliate_seller/202508/marketplace_creators/search";
    let qp = `page_size=12&app_key=${creds.appKey}&shop_id=${creds.shopId}&shop_cipher=${creds.shopCipher}&access_token=${creds.accessToken}`;
    const rawUrl = `${baseUrl}?${qp}`;
    const { sign, ts } = generateSign(creds.appSecret, rawUrl, body);
    const signedUrl = `${rawUrl}&sign=${sign}&timestamp=${ts}`;

    const resp = await fetch(signedUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-tts-access-token": creds.accessToken,
      },
      body: JSON.stringify(body),
    });
    const result = await resp.json();

    if (result.code !== 0 || !result.data?.creators?.length) return null;

    const creators = result.data.creators;
    const match =
      creators.find(
        (c: { username: string }) =>
          c.username.toLowerCase() === cleanHandle.toLowerCase()
      ) || creators[0];

    let gmvVal: number | null = null;
    if (match.gmv?.amount) {
      gmvVal = parseFloat(match.gmv.amount);
      if (isNaN(gmvVal)) gmvVal = null;
    }

    return {
      gmv: gmvVal,
      avg_view: match.avg_ec_video_view_count ?? null,
      followers: match.follower_count ?? null,
    };
  } catch (err) {
    console.error(`  [TikTok] Error for @${handle}:`, err);
    return null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function extractPriceAI(
  handle: string,
  replyText: string
): Promise<{ price_per_video: number | null; price_comment: string | null }> {
  const clean = stripHtml(replyText).slice(0, 2000);
  const prompt = `Extract the creator's price per single TikTok video from this email reply.

Creator: @${handle}
Reply:
${clean}

Rules:
- Extract the single TikTok video rate in USD only
- If bundle deals exist (e.g. "2 videos: $800"), calculate single video rate ($400)
- Ignore IG Reel, UGC, YouTube, or non-TikTok prices
- If no clear TikTok video price, return null
- price_comment: concise note (max 80 chars) about rate structure

Respond ONLY with JSON: {"price_per_video": <number|null>, "price_comment": "<string|null>"}`;

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      response_format: { type: "json_object" },
      max_tokens: 100,
    });
    return JSON.parse(resp.choices[0].message.content || "{}");
  } catch {
    return { price_per_video: null, price_comment: null };
  }
}

// ── Types ────────────────────────────────────────────────────────────────────
interface ReplyRow {
  handle: string | null;
  creator_email: string;
  creator_name: string;
  reply_email: string;
  reply_name: string | null;
  reply_text: string;
  received_at: string;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  await prodPg.query("SELECT 1");
  console.log(`Connected to prod DB`);
  console.log(
    `Campaign: ${CAMPAIGN_ID} | Mode: ${isDryRun ? "DRY RUN" : "LIVE"}${skipEnrich ? " | Skip enrich" : ""}\n`
  );

  // Step 1: Fetch replied creators from campaign
  console.log("Step 1: Fetching replied creators from campaign...");
  const { rows: replies } = await prodPg.query<ReplyRow>(
    `SELECT DISTINCT ON (COALESCE(tcu.unique_id, cer.email))
       tcu.unique_id as handle,
       cer.email as creator_email,
       outbound.to_name as creator_name,
       inbound.from_email as reply_email,
       inbound.from_name as reply_name,
       regexp_replace(
         regexp_replace(LEFT(inbound.content, 3000), '<[^>]+>', ' ', 'g'),
         '\\s+', ' ', 'g'
       ) as reply_text,
       inbound.received_at::text
     FROM brand.email_tracking_events ete
     JOIN brand.email_messages outbound ON outbound.id = ete.email_message_id
     JOIN brand.email_messages inbound ON inbound.id = ete.related_email_message_id
     JOIN brand.campaign_email_recipients cer
       ON cer.campaign_id = outbound.campaign_id
       AND cer.tiktok_creator_info_id = outbound.tiktok_creator_info_id
     LEFT JOIN brand.tiktok_creator_unique_ids tcu
       ON tcu.tiktok_creator_info_id::text = outbound.tiktok_creator_info_id
     WHERE outbound.campaign_id = $1
     AND ete.event_type = 'REPLIED'
     ORDER BY COALESCE(tcu.unique_id, cer.email), inbound.received_at DESC`,
    [CAMPAIGN_ID]
  );

  console.log(`  Found ${replies.length} replied creators\n`);

  // Filter to only those with handles
  const withHandle = replies.filter((r) => r.handle);
  const noHandle = replies.filter((r) => !r.handle);
  console.log(`  With TikTok handle: ${withHandle.length}`);
  console.log(`  Without handle (skipped): ${noHandle.length}\n`);

  // Step 2: Check existing creators in tracker DB
  console.log("Step 2: Checking existing creator_master records...");
  const handles = withHandle.map((r) =>
    r.handle!.toLowerCase().replace(/^@/, "").replace(/^\.+/, "")
  );

  const { data: existingCreators } = await trackerDb
    .from("creator_master")
    .select("id, handle, price_per_video, email")
    .in("handle", handles);

  const existingMap = new Map<string, { id: string; price_per_video: number | null; email: string | null }>();
  (existingCreators || []).forEach((c) =>
    existingMap.set(c.handle.toLowerCase(), {
      id: c.id,
      price_per_video: c.price_per_video,
      email: c.email,
    })
  );

  const newCreators = withHandle.filter(
    (r) => !existingMap.has(r.handle!.toLowerCase().replace(/^\.+/, ""))
  );
  const existingReplied = withHandle.filter((r) =>
    existingMap.has(r.handle!.toLowerCase().replace(/^\.+/, ""))
  );

  console.log(`  Existing in master: ${existingReplied.length}`);
  console.log(`  New creators: ${newCreators.length}\n`);

  // Step 3: Extract pricing with OpenAI + insert/update
  console.log("Step 3: Processing creators...\n");
  const stats = {
    new_created: 0,
    existing_updated: 0,
    no_price: 0,
    enriched: 0,
    enrich_failed: 0,
    error: 0,
  };

  const allToProcess = [...newCreators, ...existingReplied];
  const enrichHandles: string[] = [];

  for (let i = 0; i < allToProcess.length; i += BATCH) {
    const batch = allToProcess.slice(i, i + BATCH);
    const label = `[${i + 1}-${Math.min(i + BATCH, allToProcess.length)}/${allToProcess.length}]`;
    process.stdout.write(`${label} `);

    const results = await Promise.all(
      batch.map(async (r) => {
        const cleanHandle = r
          .handle!.toLowerCase()
          .replace(/^@/, "")
          .replace(/^\.+/, "");
        const isExisting = existingMap.has(cleanHandle);

        // Extract price with OpenAI
        const { price_per_video, price_comment } = await extractPriceAI(
          cleanHandle,
          r.reply_text
        );

        if (isDryRun) {
          const tag = isExisting ? "UPDATE" : "NEW";
          process.stdout.write(
            `\n  [${tag}] @${cleanHandle} → $${price_per_video ?? "N/A"}${price_comment ? ` (${price_comment})` : ""}`
          );
          if (price_per_video) {
            isExisting ? stats.existing_updated++ : stats.new_created++;
          } else {
            stats.no_price++;
          }
          return;
        }

        try {
          if (isExisting) {
            // Existing creator: add pricing history only
            const existing = existingMap.get(cleanHandle)!;

            if (price_per_video) {
              // Update email if missing
              const updates: Record<string, unknown> = {
                updated_at: new Date().toISOString(),
              };
              if (!existing.email && r.creator_email) {
                updates.email = r.creator_email;
              }
              // Update price_per_video and price_comment
              updates.price_per_video = price_per_video;
              if (price_comment) updates.price_comment = price_comment;

              await trackerDb
                .from("creator_master")
                .update(updates)
                .eq("id", existing.id);

              // Add pricing history
              await trackerDb.from("creator_pricing_history").upsert(
                {
                  creator_master_id: existing.id,
                  recorded_at: new Date().toISOString().split("T")[0],
                  price_per_video,
                  price_comment,
                  source: "campaign_reply",
                },
                { onConflict: "creator_master_id,recorded_at" }
              );

              stats.existing_updated++;
              process.stdout.write(`U`);
            } else {
              stats.no_price++;
              process.stdout.write(`.`);
            }
          } else {
            // New creator: create master + pricing history
            const email = r.creator_email || r.reply_email;
            const insertData: Record<string, unknown> = {
              handle: cleanHandle,
              email,
            };
            if (price_per_video) {
              insertData.price_per_video = price_per_video;
              if (price_comment) insertData.price_comment = price_comment;
            }

            const { data: created, error: createErr } = await trackerDb
              .from("creator_master")
              .upsert(insertData, { onConflict: "handle" })
              .select()
              .single();

            if (createErr || !created) {
              console.error(
                `\n  ERROR creating @${cleanHandle}:`,
                createErr?.message
              );
              stats.error++;
              return;
            }

            // Add pricing history
            if (price_per_video) {
              await trackerDb.from("creator_pricing_history").upsert(
                {
                  creator_master_id: created.id,
                  recorded_at: new Date().toISOString().split("T")[0],
                  price_per_video,
                  price_comment,
                  source: "campaign_reply",
                },
                { onConflict: "creator_master_id,recorded_at" }
              );
            }

            enrichHandles.push(cleanHandle);
            stats.new_created++;
            process.stdout.write(`+`);
          }
        } catch (err) {
          console.error(`\n  ERROR @${cleanHandle}:`, err);
          stats.error++;
        }
      })
    );

    // Pause between batches (OpenAI rate limit)
    if (i + BATCH < allToProcess.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log("\n");

  // Step 4: Enrich new creators with TikTok API
  if (!skipEnrich && !isDryRun && enrichHandles.length > 0) {
    console.log(
      `Step 4: Enriching ${enrichHandles.length} new creators with TikTok API...\n`
    );

    for (let i = 0; i < enrichHandles.length; i++) {
      const handle = enrichHandles[i];
      process.stdout.write(
        `  [${i + 1}/${enrichHandles.length}] @${handle} ... `
      );

      const data = await enrichFromTikTok(handle);
      if (!data) {
        process.stdout.write(`not found\n`);
        stats.enrich_failed++;
        continue;
      }

      // Update creator_master
      const { data: creator } = await trackerDb
        .from("creator_master")
        .select("id, price_per_video")
        .eq("handle", handle)
        .single();

      if (!creator) {
        stats.enrich_failed++;
        process.stdout.write(`master not found\n`);
        continue;
      }

      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (data.gmv != null) updates.gmv = data.gmv;
      if (data.avg_view != null) updates.avg_view = data.avg_view;
      if (data.followers != null) updates.followers = data.followers;

      // Calculate tier
      if (creator.price_per_video && data.avg_view) {
        const tier = calculateTier(
          Number(creator.price_per_video),
          Number(data.avg_view),
          Number(data.gmv) || 0
        );
        if (tier !== null) updates.tier = tier;
      }

      await trackerDb.from("creator_master").update(updates).eq("id", creator.id);

      // Pricing history with TikTok data
      await trackerDb.from("creator_pricing_history").upsert(
        {
          creator_master_id: creator.id,
          recorded_at: new Date().toISOString().split("T")[0],
          gmv: data.gmv,
          avg_view: data.avg_view,
          followers: data.followers,
          price_per_video: creator.price_per_video,
          tier: updates.tier as number | undefined,
          source: "tiktok_api",
        },
        { onConflict: "creator_master_id,recorded_at" }
      );

      stats.enriched++;
      process.stdout.write(
        `GMV=${data.gmv ?? "N/A"} avg_view=${data.avg_view ?? "N/A"} followers=${data.followers ?? "N/A"}\n`
      );

      // TikTok API rate limit: 300ms
      await new Promise((r) => setTimeout(r, 300));
    }
  } else if (skipEnrich) {
    console.log("Step 4: Skipped TikTok enrichment (--skip-enrich)\n");
  } else if (isDryRun) {
    console.log(
      `Step 4: Would enrich ${enrichHandles.length} new creators with TikTok API\n`
    );
  }

  await prodPg.end();

  // Summary
  console.log(`${"─".repeat(50)}`);
  console.log(`Done${isDryRun ? " (DRY RUN)" : ""} - Campaign ${CAMPAIGN_ID}`);
  console.log(`  New creators added   : ${stats.new_created}`);
  console.log(`  Existing updated     : ${stats.existing_updated}`);
  console.log(`  No price in reply    : ${stats.no_price}`);
  console.log(`  TikTok enriched      : ${stats.enriched}`);
  console.log(`  TikTok enrich failed : ${stats.enrich_failed}`);
  console.log(`  Errors               : ${stats.error}`);
}

main().catch(console.error);
