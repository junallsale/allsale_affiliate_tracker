import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase-server";
import { enrichCreatorData } from "@/lib/tiktok-api";

async function requireAuthClient() {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  return supabase;
}

/**
 * POST /api/affiliates/enrich
 *
 * Body options:
 *   { "mode": "backfill" }                 — Enrich all affiliates with null gmv or avg_view
 *   { "ids": ["id1", "id2"] }              — Enrich specific affiliates by ID
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await requireAuthClient();
    const body = await request.json();
    const { mode, ids } = body;

    // Determine which affiliates to enrich
    let query = supabase.from("affiliate_creators").select("id, handle, gmv, avg_view");

    if (mode === "backfill") {
      query = query.or("gmv.is.null,avg_view.is.null");
    } else if (ids && Array.isArray(ids) && ids.length > 0) {
      query = query.in("id", ids);
    } else {
      return NextResponse.json({ error: "Provide mode='backfill' or ids array" }, { status: 400 });
    }

    const { data: affiliates, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!affiliates || affiliates.length === 0) {
      return NextResponse.json({ message: "No affiliates to enrich", enriched: 0, skipped: 0 });
    }

    let enriched = 0;
    let skipped = 0;
    const results: { handle: string; status: string; data?: Record<string, unknown> }[] = [];

    for (const affiliate of affiliates) {
      if (!affiliate.handle) {
        skipped++;
        results.push({ handle: "(empty)", status: "skipped" });
        continue;
      }

      const data = await enrichCreatorData(affiliate.handle);
      if (!data) {
        skipped++;
        results.push({ handle: affiliate.handle, status: "not_found" });
        continue;
      }

      // Only update fields that are currently null
      const updates: Record<string, unknown> = {};
      if (affiliate.gmv == null && data.gmv != null) updates.gmv = data.gmv;
      if (affiliate.avg_view == null && data.avg_view != null) updates.avg_view = data.avg_view;
      if (data.followers != null) updates.followers = data.followers;

      if (Object.keys(updates).length === 0) {
        skipped++;
        results.push({ handle: affiliate.handle, status: "already_filled" });
        continue;
      }

      updates.updated_at = new Date().toISOString();

      const { error: updateError } = await supabase
        .from("affiliate_creators")
        .update(updates)
        .eq("id", affiliate.id);

      if (updateError) {
        results.push({ handle: affiliate.handle, status: "error", data: { error: updateError.message } });
        skipped++;
      } else {
        enriched++;
        results.push({ handle: affiliate.handle, status: "enriched", data: updates });
      }

      // Rate limit: TikTok allows 10,000/day, but be gentle
      await new Promise((r) => setTimeout(r, 300));
    }

    return NextResponse.json({
      message: `Enriched ${enriched} affiliates, skipped ${skipped}`,
      enriched,
      skipped,
      total: affiliates.length,
      results,
    });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
