import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

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

const HANDLES = process.argv[2] === '--file'
  ? readFileSync(process.argv[3], 'utf-8').replace(/\r/g, '').split('\n').map(h => h.trim().replace(/^@/, '')).filter(Boolean)
  : `cakedfinds
423kidk
dealsbydavid
ryankevintomlinson
luxshopz
silving95
janayvictorias
undiaconsaily
rekyia.23
zur.yda
josueantunez77
shopwithkeri
old_guy_and_a_cup
brookestuart21
rpmfinds
dealsfordayz3
alexismarieoliva
happyhourx96
savagejohnny
shelbaybay27
brostacked
mistercharsiu
carterscorner_
imjustagirl0024
limitedcollects
brittneyunfilterd
tyni_alika
summersolana
pixelgator4
nirusha.creates
sxmiafit
leila_ugc3
shop.lex.finds
kenzieleigh_
ugc_miranda
duranfavfinds03
emilydweir
thainadoitbest
janelleeelizabeth
dani.leigh24
nats.finds
thelindsey
etenn47
summeradela1
lovedbylyss
daily_pingu
fatgirlfine
karladiaz_s
xoammy_ugc
josiahposts
pmarie2
thefuturealfonsos
blakesbargains
swavvy22
joannamiss2
cassieaverytts
ashleydashley10
jinxydigital
sagun_sharma
twinmama28
cammietimm
tiktokshopdeals4you
findsbydhd
ajlittle0902
mmtipsdeals
lujalv
dealqueenz10
orixnaomi
infinity.ugc
theashtree
alexander.jha
allthingsaniyah
thedailystealz_
its.brenna
moralaqueteenamora
ttsmoneywants
littlefarm_ontheprairie
danielle.369.official
thalldealz
out0fstorage
gabshavtiktok
btypep
specificallyketchup
creakzshop
getthesedeals
neeceybest
shopwtami
ryanx.bradshaw
tukeratinacolombiana1
officiallylexip
gunngunn147
genesisa263
1kchubbss
annifer_castro
bri.rivard
perfectly.goods
jordynslack
jeanna.nichole
broken.on.purpose
delmylg3
jackieriso
lfamshopfinds
ngocng_8
marthapatrixiaa
kendallbarronn
tina_g_82
yourrbestbud
notevilhiccup
b_tari
leomaralarcon
amanda.anderson24
kalufinds
sierradcouture
shopwithsmitty
itsalexischristine
prettyhotdeals
allaroundjules
curatedbysarahjhayse
meg4laughs
the_asian_viking
heidy.perez98
marycarla_martin
sharon.jayy
midnight_les
maryvictoriaf
nyniimulan
themomma2004
nikasteward777
moreniketyi
shopdealsbyeli
rgkdetails
mommavibes1975
chrissiesttsfinds
gracieharmeyer
angebs33
daylinstipsformoms
raquelkappner
brandymedley
working.mom.tok
queenlashay91
neaveem
dailycartss
mltfinds
jodivinee
brookleann22
_lizbailey4
ihateequazn
nicksiebecker
lidiaxyang
morgandibacco
ghostgirlcosplay2
afomamedia
haydee817
di.anaaa_v
jackiejo71
fernandajmzz
usernameisjas
glowwdani
nemo_brawl
travelsntrends
jennsadhdadventures
eric.yaps
alllikay
shopaholicsahm
claudiayero_02
59andflawless
youroverstimulatedbestie
jennygreeneyes
lyssaabbby
life_choic3s
iloveslimjims678
yalushkabe
ammildesign
angelacallisto123
_mamiwander
meghouse24
shopaholicallee
ebonieb.xo
lisafabrega
fuhrealdeals
millionare.mentaliity
tiasells
thevalueshop
lifesrad
that_plus_size_girl
jerialiamaj
taylorgfinds
tarabauman80
dailydealswithme
frugal__living
authentically_amberk
winwithpags
reallyhoneyy
romansfindings
kristinadunnn
justanothernurse1
shaneicyy
stushgaltings
followmysparkles
egybestie
chikeria40
oliviatati
dantayspicks
jessicabachman4
rondadaly
_staceymaria_
sydney.shops
imkarachanel
hunterfavela
mwakakashinka
briiwears
donttakeittooseriouslyy
ladiesdeals
sahm.sober.lifestyle
colleen_fusco
passthescratch
jills.tonie.clips
marsha.shavani
thallsupply
jeremyallensmain
socialmediagirlie
ava.martiinez
trent7488
emilylynntaylor
ben.buys
milannlynn
catchinupwithtammy
morgantaylorsss
runonmagicmom
gabriel.natural
dontbeshytoobuy
west.ugc
itscharislove
whitspickswfhm
anafindstts
dealsswithaustin
chrisrtts
jeenaveth
kaayladee
forillard
luke.creations
alya.lott
sincerely_mads
buttercupblossums
palomaashop
pottersfavoritethings
llioniemedia
mrsscott0714
avatarsarai
ashflowers62588
southern_wellness
rosabel_munoz
rubenrecommends
maricelcervantesoficial
hey.karena
treasurelaurent
feddybaby
gabrielapirelaa
brookeswate22
hotgirlwellnessss
silkyreddgirl
janelmcqueen
alanareliford
bellablissfaves
kbhealth100
sandyyprz
theblackellen86
cristianyarce
mtrunnergirl
lauramontenegroa
lunafoxraereview
over50reset
crazynaturevideos
amber.mercier
mis._monica
tokshopwithkarin
lorenrosko
shoplikejcc
bethz_1105
prettyassrandomm
threedogcircus3
deals.by.dyl
jenstaaaa
trendygabriel
yuan.guerrero
cb.finds
alec.lol
brooktheshopaholic
brooklyntaylorxoxo
jayrscottyy
johnjonne
paytonhopee
goateddeals_
tt778303
shedwithtori_
casadesami
lizette.baldeo
unseen4youu
erica.recommends
janelcrawford_
alexfound.it
bryantshopp
saronthings
painted
saludparatidiario
luca.denhard
tiffywellness
create.amber.marie
_yourdailydeals
trinity.blair
daniela.reynaaa
spiritamethystt
amandaa_solis
jadealeciaaa
oraimyyyy
mipropiacomida
bestdeals.tiktok
ctrskei
mrmontzingo
nazia_siddiqui786
rachelchaleff
suprememalik`.trim().split('\n').map(h => h.trim().replace(/^@/, ''));

const uniqueHandles = [...new Set(HANDLES)];

async function main() {
  const tikDb = createClient(TIKTOK_DB_URL, TIKTOK_DB_KEY);
  const { data: credRows } = await tikDb.from("user_tiktok_info").select("access_token, shop_cipher").eq("shop_id", SHOP_ID).is("deleted_at", null).order("updated_at", { ascending: false }).limit(1);
  if (!credRows?.length) throw new Error("No credentials");
  const creds = { appKey: APP_KEY, appSecret: APP_SECRET, accessToken: credRows[0].access_token, shopId: SHOP_ID, shopCipher: credRows[0].shop_cipher };

  const results: { handle: string; gmv: number; avg_view: number; units_sold_range: string; units_sold_min: number; followers: number }[] = [];

  for (let i = 0; i < uniqueHandles.length; i++) {
    const handle = uniqueHandles[i];
    const body = { keyword: handle };
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
    const match = (result.code === 0 && result.data?.creators?.length)
      ? result.data.creators.find((c: any) => (c.username || "").toLowerCase() === handle.toLowerCase()) || null
      : null;

    if (match) {
      const gmvObj = match.gmv as { amount?: string } | undefined;
      const usr = match.units_sold_range as { formatted_range?: string; minimum_amount?: number } | undefined;
      results.push({
        handle,
        gmv: Math.round(parseFloat(gmvObj?.amount || "0")),
        avg_view: match.avg_ec_video_view_count || 0,
        units_sold_range: usr?.formatted_range || "-",
        units_sold_min: usr?.minimum_amount || 0,
        followers: match.follower_count || 0,
      });
      process.stdout.write(`[${i + 1}/${uniqueHandles.length}] @${handle} - Units: ${usr?.formatted_range || "-"} | GMV: $${Math.round(parseFloat(gmvObj?.amount || "0"))}\n`);
    } else {
      results.push({ handle, gmv: 0, avg_view: 0, units_sold_range: "not found", units_sold_min: 0, followers: 0 });
      process.stdout.write(`[${i + 1}/${uniqueHandles.length}] @${handle} - NOT FOUND\n`);
    }

    await new Promise(r => setTimeout(r, 350));
  }

  const today = new Date().toISOString().slice(0, 10);
  const csvHeader = "handle,gmv,avg_view,units_sold_range,units_sold_min,followers";
  const csvRows = results.map(r =>
    `${r.handle},${r.gmv},${r.avg_view},${r.units_sold_range},${r.units_sold_min},${r.followers}`
  );
  const csvPath = resolve(process.cwd(), `data/creator-lists/dr.forhair/units-sold-${today}.csv`);
  writeFileSync(csvPath, csvHeader + "\n" + csvRows.join("\n"));
  console.log(`\nSaved: ${csvPath} (${results.length} creators)`);
}

main().catch(console.error);
