import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

function extractPath(url: string) { return new URL(url).pathname; }
function extractParams(url: string) {
  const u = new URL(url); const p: Record<string, string | number> = {};
  u.searchParams.forEach((v, k) => { p[k] = v; }); return p;
}
function generateSign(secret: string, rawUrl: string) {
  const ts = Math.floor(Date.now() / 1000);
  const paramsObj = extractParams(rawUrl); paramsObj["timestamp"] = ts;
  delete paramsObj["sign"]; delete paramsObj["access_token"];
  const sorted = Object.keys(paramsObj).sort().reduce((o, k) => { o[k] = paramsObj[k]; return o; }, {} as Record<string, string | number>);
  let s = secret + extractPath(rawUrl);
  for (const key in sorted) s += key + sorted[key];
  s += secret;
  return { sign: crypto.createHmac("sha256", secret).update(s).digest("hex"), ts };
}

async function getTikTokCredentials(shopId?: string) {
  const targetShopId = shopId || process.env.TIKTOK_SHOP_ID!;
  const tikDb = createClient(
    process.env.TIKTOK_DB_SUPABASE_URL!,
    process.env.TIKTOK_DB_SUPABASE_KEY!
  );
  const { data } = await tikDb
    .from("user_tiktok_info")
    .select("access_token, shop_cipher")
    .eq("shop_id", targetShopId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (!data?.length) throw new Error(`No TikTok credentials for shop_id=${targetShopId}`);
  return {
    appKey: process.env.TIKTOK_APP_KEY!,
    appSecret: process.env.TIKTOK_APP_SECRET!,
    accessToken: data[0].access_token,
    shopId: targetShopId,
    shopCipher: data[0].shop_cipher,
  };
}

async function fetchVideoPerformance(
  creds: Awaited<ReturnType<typeof getTikTokCredentials>>,
  targetIds: Set<string>
) {
  const found = new Map<string, { views: number; gmv: number }>();
  let pageToken = "";
  let page = 0;

  // Fetch last 90 days
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 90);
  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  // Stop early if all targets found, or max 30 pages (~30 seconds)
  while (found.size < targetIds.size && page < 30) {
    page++;
    let qp = `start_date_ge=${startStr}&end_date_lt=${endStr}&page_size=100&account_type=ALL&app_key=${creds.appKey}&shop_id=${creds.shopId}&shop_cipher=${creds.shopCipher}&access_token=${creds.accessToken}`;
    if (pageToken) qp += `&page_token=${pageToken}`;

    const baseUrl = "https://open-api.tiktokglobalshop.com/analytics/202409/shop_videos/performance";
    const rawUrl = `${baseUrl}?${qp}`;
    const { sign, ts } = generateSign(creds.appSecret, rawUrl);
    const signedUrl = `${rawUrl}&sign=${sign}&timestamp=${ts}`;

    const res = await fetch(signedUrl, {
      headers: { "x-tts-access-token": creds.accessToken },
    });
    const result = await res.json();
    if (result.code !== 0) break;

    const videos = result.data?.videos || [];
    if (videos.length === 0) break;

    for (const v of videos) {
      if (targetIds.has(v.id)) {
        found.set(v.id, {
          views: v.views || 0,
          gmv: v.gmv?.amount ? parseFloat(v.gmv.amount) : 0,
        });
      }
    }

    pageToken = result.data?.next_page_token || "";
    if (!pageToken) break;
  }

  return found;
}

/**
 * POST /api/videos/refresh
 * Body: { project_id: string }
 *
 * 1. Resolve short URLs to get tiktok_video_id
 * 2. Fetch all video performance from TikTok
 * 3. Update matching videos in DB
 */
export async function POST(request: NextRequest) {
  try {
    const { project_id } = await request.json();
    if (!project_id) {
      return NextResponse.json({ error: "project_id required" }, { status: 400 });
    }

    const supabase = getServiceClient();

    // Look up brand's tiktok_shop_id via project
    const { data: projectData } = await supabase
      .from("projects")
      .select("brand_id, brands(tiktok_shop_id)")
      .eq("id", project_id)
      .single();

    const brandShopId = (projectData?.brands as { tiktok_shop_id?: string } | null)?.tiktok_shop_id || undefined;

    // Get all videos for this project
    const { data: pcData } = await supabase
      .from("project_creators")
      .select("id")
      .eq("project_id", project_id)
      .or("is_deleted.is.null,is_deleted.eq.false");

    const pcIds = (pcData || []).map((pc) => pc.id);
    if (pcIds.length === 0) {
      return NextResponse.json({ message: "No creators in project", updated: 0 });
    }

    const { data: videos } = await supabase
      .from("videos")
      .select("id, tiktok_url, tiktok_video_id")
      .in("project_creator_id", pcIds);

    if (!videos || videos.length === 0) {
      return NextResponse.json({ message: "No videos to refresh", updated: 0 });
    }

    // Resolve missing tiktok_video_ids from short URLs
    for (const video of videos) {
      if (video.tiktok_video_id) continue;

      try {
        const res = await fetch(video.tiktok_url, { method: "HEAD", redirect: "follow" });
        const finalUrl = res.url;
        const match = finalUrl.match(/\/video\/(\d+)/);
        if (match) {
          video.tiktok_video_id = match[1];
          await supabase
            .from("videos")
            .update({ tiktok_video_id: match[1] })
            .eq("id", video.id);
        }
      } catch {
        // skip
      }
    }

    const videoIdMap = new Map<string, string>(); // tiktok_video_id → db video id
    for (const v of videos) {
      if (v.tiktok_video_id) {
        videoIdMap.set(v.tiktok_video_id, v.id);
      }
    }

    if (videoIdMap.size === 0) {
      return NextResponse.json({ message: "No video IDs resolved", updated: 0 });
    }

    // Fetch performance data from TikTok (using brand's shop_id)
    const creds = await getTikTokCredentials(brandShopId);
    const targetIds = new Set(videoIdMap.keys());
    const perfData = await fetchVideoPerformance(creds, targetIds);

    // Update matching videos
    let updated = 0;
    for (const [tikTokId, dbId] of videoIdMap) {
      const perf = perfData.get(tikTokId);
      if (perf) {
        await supabase
          .from("videos")
          .update({ view_count: perf.views, gmv: perf.gmv })
          .eq("id", dbId);
        updated++;
      }
    }

    return NextResponse.json({
      message: `Refreshed ${updated} videos`,
      total_videos: videos.length,
      resolved_ids: videoIdMap.size,
      tiktok_videos_fetched: perfData.size,
      updated,
    });
  } catch (err) {
    console.error("Video refresh error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
