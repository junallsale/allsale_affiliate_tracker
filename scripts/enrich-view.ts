/**
 * Enrich all creators in a specific view with TikTok API data (gmv, avg_view, followers, tier)
 * Usage: npx tsx scripts/enrich-view.ts <project_name>
 * Example: npx tsx scripts/enrich-view.ts 2603_Paid
 */
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { calculateTier } from "../src/lib/pricing";

const envPath = resolve(process.cwd(), ".env.local");
for (const line of readFileSync(envPath, "utf-8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  if (!process.env[t.slice(0, eq).trim()]) process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
}

const APP_KEY = process.env.TIKTOK_APP_KEY!;
const APP_SECRET = process.env.TIKTOK_APP_SECRET!;
const SHOP_ID = process.env.TIKTOK_SHOP_ID!;
const TIKTOK_DB_URL = process.env.TIKTOK_DB_SUPABASE_URL!;
const TIKTOK_DB_KEY = process.env.TIKTOK_DB_SUPABASE_KEY!;

function extractPath(url: string) { return new URL(url).pathname; }
function extractParams(url: string) {
  const u = new URL(url); const p: Record<string, string | number> = {};
  u.searchParams.forEach((v, k) => { p[k] = v; }); return p;
}
function generateSign(secret: string, rawUrl: string, body?: Record<string, unknown>) {
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
  const projectName = process.argv[2];
  if (!projectName) { console.error("Usage: npx tsx scripts/enrich-view.ts <project_name>"); return; }

  const tikDb = createClient(TIKTOK_DB_URL, TIKTOK_DB_KEY);
  const { data: credRows } = await tikDb.from("user_tiktok_info").select("access_token, shop_cipher").eq("shop_id", SHOP_ID).is("deleted_at", null).order("updated_at", { ascending: false }).limit(1);
  if (!credRows?.length) throw new Error("No TikTok credentials");
  const creds = { appKey: APP_KEY, appSecret: APP_SECRET, accessToken: credRows[0].access_token, shopId: SHOP_ID, shopCipher: credRows[0].shop_cipher };

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: rows, error } = await supabase
    .from("affiliate_creators")
    .select("id, handle, gmv, avg_view, followers, price_per_video")
    .eq("project", projectName)
    .order("created_at", { ascending: false });

  if (error || !rows) { console.error("Fetch error:", error); return; }
  console.log(`Found ${rows.length} creators in project '${projectName}'\n`);

  let enriched = 0, skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.handle) { skipped++; continue; }
    const cleanHandle = row.handle.replace(/^@+/, '');

    const body = { keyword: cleanHandle };
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
    let match: any = null;
    if (result.code === 0 && result.data?.creators?.length) {
      match = result.data.creators.find((c: any) => (c.username || "").toLowerCase() === cleanHandle.toLowerCase()) || null;
    }

    if (match) {
      const gmvObj = match.gmv as { amount?: string } | undefined;
      const newGmv = gmvObj?.amount ? parseFloat(gmvObj.amount) : 0;
      const newAvgView = match.avg_ec_video_view_count || 0;
      const newFollowers = match.follower_count || 0;

      const updates: Record<string, unknown> = {
        gmv: newGmv,
        avg_view: newAvgView,
        followers: newFollowers,
        updated_at: new Date().toISOString(),
      };

      const ppv = Number(row.price_per_video) || 0;
      if (ppv && newAvgView) {
        const tier = calculateTier(ppv, newAvgView, newGmv);
        if (tier !== null) updates.tier = tier;
      }

      await supabase.from("affiliate_creators").update(updates).eq("id", row.id);

      // Also update creator_master + pricing_history
      const { data: master } = await supabase
        .from("creator_master")
        .upsert({ handle: cleanHandle, gmv: newGmv, avg_view: newAvgView, followers: newFollowers, tier: updates.tier || null, updated_at: new Date().toISOString() }, { onConflict: "handle" })
        .select("id")
        .single();
      if (master) {
        await supabase.from("creator_pricing_history").upsert({
          creator_master_id: master.id,
          recorded_at: new Date().toISOString().split("T")[0],
          gmv: newGmv, avg_view: newAvgView, followers: newFollowers,
          price_per_video: ppv || null, tier: updates.tier || null, source: "tiktok_api",
        }, { onConflict: "creator_master_id,recorded_at" });
      }

      enriched++;
      process.stdout.write(`[${i + 1}/${rows.length}] @${cleanHandle} - GMV: $${Math.round(newGmv)} | avg: ${newAvgView} | followers: ${newFollowers}${updates.tier ? ` | tier: ${updates.tier}` : ''}\n`);
    } else {
      skipped++;
      process.stdout.write(`[${i + 1}/${rows.length}] @${row.handle} - NOT FOUND\n`);
    }

    await new Promise(r => setTimeout(r, 350));
  }

  console.log(`\nDone. Enriched: ${enriched}, Skipped: ${skipped}`);
}

main().catch(console.error);
