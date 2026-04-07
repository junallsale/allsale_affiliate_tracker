import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServer } from "@/lib/supabase-server";
import { enrichCreatorData } from "@/lib/tiktok-api";
import { calculateTier } from "@/lib/pricing";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

async function requireAuth() {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  return user;
}

/**
 * POST /api/creators/master/enrich
 *
 * Body options:
 *   { "handles": ["handle1", "handle2"] }  — Enrich specific creators by handle
 *   { "mode": "backfill" }                 — Enrich all creators with null gmv or avg_view
 *
 * Fetches TikTok data (GMV, avg_view, followers) and updates creator_master + creator_pricing_history.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAuth();
    const supabase = getServiceClient();
    const body = await request.json();
    const { handles, mode } = body;

    // Determine which creators to enrich
    let query = supabase.from("creator_master").select("id, handle, gmv, avg_view, price_per_video");

    if (mode === "backfill") {
      query = query.or("gmv.is.null,avg_view.is.null");
    } else if (handles && Array.isArray(handles) && handles.length > 0) {
      const cleaned = handles.map((h: string) => h.toLowerCase().replace(/^@/, ""));
      query = query.in("handle", cleaned);
    } else {
      return NextResponse.json({ error: "Provide handles array or mode='backfill'" }, { status: 400 });
    }

    const { data: creators, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!creators || creators.length === 0) {
      return NextResponse.json({ message: "No creators to enrich", enriched: 0, skipped: 0 });
    }

    let enriched = 0;
    let skipped = 0;
    const results: { handle: string; status: string; data?: Record<string, unknown> }[] = [];

    for (const creator of creators) {
      if (!creator.handle) {
        skipped++;
        results.push({ handle: "(empty)", status: "skipped" });
        continue;
      }

      const data = await enrichCreatorData(creator.handle);
      if (!data) {
        skipped++;
        results.push({ handle: creator.handle, status: "not_found" });
        continue;
      }

      // Build updates
      const updates: Record<string, unknown> = {};
      if (data.gmv != null) updates.gmv = data.gmv;
      if (data.avg_view != null) updates.avg_view = data.avg_view;
      if (data.followers != null) updates.followers = data.followers;

      if (Object.keys(updates).length === 0) {
        skipped++;
        results.push({ handle: creator.handle, status: "no_data" });
        continue;
      }

      // Auto-calculate tier
      const ppv = creator.price_per_video;
      const avgView = data.avg_view ?? creator.avg_view;
      const gmv = data.gmv ?? creator.gmv;
      if (ppv && avgView) {
        const tier = calculateTier(Number(ppv), Number(avgView), Number(gmv) || 0);
        if (tier !== null) updates.tier = tier;
      }

      updates.updated_at = new Date().toISOString();

      // Update creator_master
      const { error: updateError } = await supabase
        .from("creator_master")
        .update(updates)
        .eq("id", creator.id);

      if (updateError) {
        results.push({ handle: creator.handle, status: "error", data: { error: updateError.message } });
        skipped++;
        continue;
      }

      // Insert/upsert pricing history
      const historyData: Record<string, unknown> = {
        creator_master_id: creator.id,
        recorded_at: new Date().toISOString().split("T")[0],
        source: "tiktok_api",
      };
      if (data.gmv != null) historyData.gmv = data.gmv;
      if (data.avg_view != null) historyData.avg_view = data.avg_view;
      if (data.followers != null) historyData.followers = data.followers;
      if (creator.price_per_video != null) historyData.price_per_video = creator.price_per_video;
      if (updates.tier != null) historyData.tier = updates.tier;

      await supabase.from("creator_pricing_history").upsert(historyData, {
        onConflict: "creator_master_id,recorded_at",
      });

      enriched++;
      results.push({ handle: creator.handle, status: "enriched", data: updates });

      // Rate limit
      await new Promise((r) => setTimeout(r, 300));
    }

    return NextResponse.json({
      message: `Enriched ${enriched} creators, skipped ${skipped}`,
      enriched,
      skipped,
      total: creators.length,
      results,
    });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
