import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

// ── Types ────────────────────────────────────────────────────────────────

interface TikTokShopCredentials {
  appKey: string;
  appSecret: string;
  accessToken: string;
  shopId: string;
  shopCipher: string;
}

interface CreatorMarketplaceResult {
  username: string;
  nickname: string;
  follower_count: number;
  avg_ec_video_view_count: number;
  gmv?: { currency: string; amount: string };
  gmv_range?: { currency: string; minimum_amount: string; maximum_amount: string; formatted_range: string };
  creator_open_id: string;
}

export interface EnrichedCreatorData {
  gmv: number | null;
  avg_view: number | null;
  followers: number | null;
}

// ── Signing ──────────────────────────────────────────────────────────────

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

function buildSignedUrl(
  creds: TikTokShopCredentials,
  baseUrl: string,
  params?: string,
  body?: Record<string, unknown>,
  exceptParams?: string[]
): string {
  const except = new Set(exceptParams || []);
  let queryParams = params || "";

  if (!except.has("app_key")) {
    queryParams += `${queryParams ? "&" : ""}app_key=${creds.appKey}`;
  }
  if (!except.has("shop_id")) {
    queryParams += `${queryParams ? "&" : ""}shop_id=${creds.shopId}`;
  }
  if (!except.has("shop_cipher")) {
    queryParams += `${queryParams ? "&" : ""}shop_cipher=${creds.shopCipher}`;
  }
  if (!except.has("access_token")) {
    queryParams += `${queryParams ? "&" : ""}access_token=${creds.accessToken}`;
  }

  const rawUrl = `${baseUrl}${queryParams ? `?${queryParams}` : ""}`;
  const { sign, ts } = generateSign(creds.appSecret, rawUrl, body);

  return `${rawUrl}&sign=${sign}&timestamp=${ts}`;
}

// ── Credentials (auto-fetch from DB) ─────────────────────────────────────

let cachedCredentials: TikTokShopCredentials | null = null;
let cachedAt = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

async function getCredentials(): Promise<TikTokShopCredentials> {
  // Return cached if fresh
  if (cachedCredentials && Date.now() - cachedAt < CACHE_TTL) {
    return cachedCredentials;
  }

  const appKey = process.env.TIKTOK_APP_KEY || process.env.NEXT_PUBLIC_TIKTOK_APP_KEY;
  const appSecret = process.env.TIKTOK_APP_SECRET || process.env.NEXT_PUBLIC_TIKTOK_APP_SECRET;
  const shopId = process.env.TIKTOK_SHOP_ID;

  if (!appKey || !appSecret || !shopId) {
    throw new Error(
      "Missing TikTok env vars: TIKTOK_APP_KEY, TIKTOK_APP_SECRET, TIKTOK_SHOP_ID"
    );
  }

  // Fetch access_token and shop_cipher from user_tiktok_info table (production DB)
  const supabaseUrl = process.env.TIKTOK_DB_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.TIKTOK_DB_SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase env vars for TikTok credential lookup");
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: rows, error } = await supabase
    .from("user_tiktok_info")
    .select("access_token, shop_cipher, shop_id")
    .eq("shop_id", shopId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error || !rows || rows.length === 0) {
    throw new Error(
      `Failed to fetch TikTok credentials for shop_id=${shopId}: ${error?.message || "not found"}`
    );
  }

  const data = rows[0];

  if (!data.access_token) {
    throw new Error(`access_token is empty for shop_id=${shopId}`);
  }

  if (!data.shop_cipher) {
    throw new Error(`shop_cipher is empty for shop_id=${shopId}. Run Get Authorized Shops API first.`);
  }

  cachedCredentials = {
    appKey,
    appSecret,
    accessToken: data.access_token,
    shopId,
    shopCipher: data.shop_cipher,
  };
  cachedAt = Date.now();

  console.log(`[TikTok API] Credentials loaded for shop_id=${shopId}`);
  return cachedCredentials;
}

// ── Search Creator on Marketplace ────────────────────────────────────────

export async function searchCreatorByHandle(
  handle: string
): Promise<CreatorMarketplaceResult | null> {
  const creds = await getCredentials();
  const cleanHandle = handle.replace(/^@+/, "").trim();

  if (!cleanHandle) return null;

  const body = { keyword: cleanHandle };

  const signedUrl = buildSignedUrl(
    creds,
    "https://open-api.tiktokglobalshop.com/affiliate_seller/202508/marketplace_creators/search",
    "page_size=12",
    body
  );

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
    console.log(`[TikTok API] No result for "${cleanHandle}": code=${result.code}, message=${result.message}`);
    return null;
  }

  // Find exact match by username
  const creators = result.data.creators as CreatorMarketplaceResult[];
  const exactMatch = creators.find(
    (c) => c.username.toLowerCase() === cleanHandle.toLowerCase()
  );

  return exactMatch || creators[0];
}

// ── Enrich single affiliate ──────────────────────────────────────────────

export async function enrichCreatorData(handle: string): Promise<EnrichedCreatorData | null> {
  try {
    const creator = await searchCreatorByHandle(handle);
    if (!creator) return null;

    let gmvValue: number | null = null;
    if (creator.gmv?.amount) {
      gmvValue = parseFloat(creator.gmv.amount);
      if (isNaN(gmvValue)) gmvValue = null;
    }

    return {
      gmv: gmvValue,
      avg_view: creator.avg_ec_video_view_count ?? null,
      followers: creator.follower_count ?? null,
    };
  } catch (err) {
    console.error(`[TikTok API] Error enriching "${handle}":`, err);
    return null;
  }
}
