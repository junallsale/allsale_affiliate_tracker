/**
 * Look up units_sold_range for specific handles via keyword search
 */
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const envPath = resolve(process.cwd(), ".env.local");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
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

const HANDLES = `jetskcqzy7m
skincarepronikki
simplymandys
giniglow
ohsoyoutalasia
angieanette
godsarchangel7
shopbyjake
orangeshoppin
hangingwithalo
megansue100
highland.fashion7
yaina1202
stephanie_ann_05
kajsa.ziebell
amberfindsdeals
imperfect.barbie
_keepingupwithmeee_
sydneyyallisonn
theallisonveer
leeleesfavfinds
lalatellsitall
sandrasfavoritefinds
kelliecrowther
sammycakes2020
adoseofwellness
lia_mania
therealmustbecindy
thelifeofbre
momfindsbyfaith
anitamironbeauty
kbeautymom75
livingthebreezylife
teaandtruecrimewithbella
tiktok_shop_christie
_naturally_b
yannnique
cicihaskill
tara.elizabeth.official
alanavibes21
baygil2
themaddiehaven
smittyyyyyyy1
paolaurdanetad
loganwalter05
little_miss_c_
lifeaskristinab2
luckylynndee
peytonxblack
paypayfinds
boise_brooke
nphiynhi
tessonnn
juliesbeautybyreview
carliejimenez2
ragdollmanor
shilohstemple
hkapproved
sheri_pie455
abbey.kline
thatmidlifeglow
annisha_vsg_tanksley0
simplyforyouxo
nativeegal
angiexroman
ntatepl
whatctlikes
therealrochellemarie
blossom.bonds
krunch.7
vivianadoestiktok
antoninalgriffin
vivaglowfinds
angelarenee1817
nurselexa
victoriaalese
michellesfaves
millennialskincare
justlikecandi3
definitelyneededthat
aestheticaleestyles
whambam.emilyanne
marvdiscounts
naturallyellen
affiliatetammytaylor
thehairhoneys
poshwhitepony
craftyheauxx
karenellieth13
ashlandandco
sinceramente_bea
bossbellaaa
misseygt
takara.moore
creadoradeofertas
yisidegarcia
deesshopfinds
christimponce
alicias.tok
hilss_fit
damnitjanett
karime.marquezv
avigailschwartz1
emiimb
amaniwortham
simplyhershop
meghanehale
peytonxblack
therealmiaali2
jadathedream
drew.review1
theresebyron
carly_unfiltered
toeverymom
drew.review
keilynbustamante
biohacking.babe
mammagonz
arenee.mua`.trim().split("\n").map(h => h.trim().replace(/^@/, ""));

// Deduplicate handles
const uniqueHandles = [...new Set(HANDLES)];

async function main() {
  const supabase = createClient(TIKTOK_DB_URL, TIKTOK_DB_KEY);
  const { data: rows } = await supabase.from("user_tiktok_info").select("access_token, shop_cipher").eq("shop_id", SHOP_ID).is("deleted_at", null).order("updated_at", { ascending: false }).limit(1);
  if (!rows?.length) throw new Error("No credentials");
  const creds = { appKey: APP_KEY, appSecret: APP_SECRET, accessToken: rows[0].access_token, shopId: SHOP_ID, shopCipher: rows[0].shop_cipher };

  const results: { handle: string; gmv: string; units_sold_range: string; units_sold_min: number; avg_view: number; followers: number; found: boolean }[] = [];

  for (let i = 0; i < uniqueHandles.length; i++) {
    const handle = uniqueHandles[i];
    const body = { keyword: handle };

    let qp = `page_size=12&app_key=${creds.appKey}&shop_id=${creds.shopId}&shop_cipher=${creds.shopCipher}&access_token=${creds.accessToken}`;
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

    if (result.code !== 0 || !result.data?.creators?.length) {
      results.push({ handle, gmv: "", units_sold_range: "", units_sold_min: 0, avg_view: 0, followers: 0, found: false });
      process.stdout.write(`[${i + 1}/${uniqueHandles.length}] @${handle} - NOT FOUND\n`);
    } else {
      const creators = result.data.creators;
      const match = creators.find((c: any) => (c.username || "").toLowerCase() === handle.toLowerCase()) || null;
      if (match) {
        const gmvObj = match.gmv as { amount?: string } | undefined;
        const usr = match.units_sold_range as { formatted_range?: string; minimum_amount?: number } | undefined;
        results.push({
          handle,
          gmv: gmvObj?.amount || "0",
          units_sold_range: usr?.formatted_range || "-",
          units_sold_min: usr?.minimum_amount || 0,
          avg_view: match.avg_ec_video_view_count || 0,
          followers: match.follower_count || 0,
          found: true,
        });
        process.stdout.write(`[${i + 1}/${uniqueHandles.length}] @${handle} - GMV: $${gmvObj?.amount || 0} | Units: ${usr?.formatted_range || "-"}\n`);
      } else {
        results.push({ handle, gmv: "", units_sold_range: "", units_sold_min: 0, avg_view: 0, followers: 0, found: false });
        process.stdout.write(`[${i + 1}/${uniqueHandles.length}] @${handle} - no exact match\n`);
      }
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 350));
  }

  const foundCount = results.filter(r => r.found).length;
  console.log(`\n=== Found ${foundCount}/${uniqueHandles.length} ===\n`);

  // CSV output
  console.log("handle,gmv,units_sold_range,units_sold_min,avg_view,followers");
  for (const r of results) {
    if (r.found) {
      console.log(`${r.handle},${r.gmv},${r.units_sold_range},${r.units_sold_min},${r.avg_view},${r.followers}`);
    } else {
      console.log(`${r.handle},,not found,,,`);
    }
  }

  // Save CSV
  const today = new Date().toISOString().slice(0, 10);
  const csvHeader = "handle,gmv,units_sold_range,units_sold_min,avg_view,followers";
  const csvRows = results.map(r => r.found
    ? `${r.handle},${r.gmv},${r.units_sold_range},${r.units_sold_min},${r.avg_view},${r.followers}`
    : `${r.handle},,not found,,,`
  );
  const csvPath = resolve(process.cwd(), `data/creator-lists/units-sold-${today}.csv`);
  writeFileSync(csvPath, csvHeader + "\n" + csvRows.join("\n"));
  console.log(`\nSaved: ${csvPath}`);
}

main().catch(console.error);
