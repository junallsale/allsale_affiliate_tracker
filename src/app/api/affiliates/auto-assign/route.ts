import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServer } from "@/lib/supabase-server";

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
 * POST /api/affiliates/auto-assign
 *
 * Body: {
 *   handles: string[],        // creator handles to assign
 *   brand_id: string,         // target brand
 *   project_id: string,       // target project
 *   status?: string,          // default: 'Confirm Req'
 * }
 *
 * 1. Check ALL projects under this brand for existing handles (including is_deleted)
 * 2. Check affiliate_creators for existing handles in same brand+project
 * 3. Insert non-duplicate handles into affiliate_creators
 * 4. Return assigned/skipped counts
 */
export async function POST(request: NextRequest) {
  try {
    await requireAuth();
    const supabase = getServiceClient();
    const { handles, brand_id, project_id, status = "Confirm Req" } = await request.json();

    if (!handles?.length || !brand_id || !project_id) {
      return NextResponse.json({ error: "handles, brand_id, project_id required" }, { status: 400 });
    }

    const cleanHandles = handles.map((h: string) => h.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);

    // 1. Get all projects under this brand
    const { data: brandProjects } = await supabase
      .from("projects")
      .select("id")
      .eq("brand_id", brand_id);
    const brandProjectIds = (brandProjects || []).map(p => p.id);

    // 2. Find handles already in ANY project of this brand (project_creators, including is_deleted)
    let existingInBrand = new Set<string>();
    if (brandProjectIds.length > 0) {
      const { data: existingPCs } = await supabase
        .from("project_creators")
        .select("creator_id, creators(tiktok_handle)")
        .in("project_id", brandProjectIds);

      for (const pc of (existingPCs || []) as any[]) {
        const handle = (pc.creators?.tiktok_handle || "").toLowerCase();
        if (handle) existingInBrand.add(handle);
      }
    }

    // 3. Also check affiliate_creators for same brand+project combo
    const { data: existingAffiliates } = await supabase
      .from("affiliate_creators")
      .select("handle")
      .eq("brand_id", brand_id)
      .eq("project_id", project_id);

    const existingAffHandles = new Set(
      (existingAffiliates || []).map(a => (a.handle || "").toLowerCase().replace(/^@/, ""))
    );

    // 4. Filter out duplicates
    const toAssign: string[] = [];
    const skippedHandles: string[] = [];

    for (const handle of cleanHandles) {
      if (existingInBrand.has(handle) || existingAffHandles.has(handle)) {
        skippedHandles.push(handle);
      } else {
        toAssign.push(handle);
      }
    }

    // 5. Get creator_master data for handles to assign
    let assigned = 0;
    for (const handle of toAssign) {
      const { data: master } = await supabase
        .from("creator_master")
        .select("*")
        .eq("handle", handle)
        .maybeSingle();

      const insertData: Record<string, unknown> = {
        handle,
        brand_id,
        project_id,
        status,
        thread: `https://allsale-affiliate.vercel.app/inbox?search=${handle}`,
      };

      // Copy data from creator_master if available
      if (master) {
        if (master.gmv) insertData.gmv = master.gmv;
        if (master.avg_view) insertData.avg_view = master.avg_view;
        if (master.followers) insertData.followers = master.followers;
        if (master.price_per_video) insertData.price_per_video = master.price_per_video;
        if (master.price_comment) insertData.price_comment = master.price_comment;
        if (master.tier) insertData.tier = master.tier;
        if (master.category) insertData.category = master.category;
        if (master.gender) insertData.gender = master.gender;
        if (master.email) insertData.email = master.email;
      }

      const { error } = await supabase.from("affiliate_creators").insert(insertData);
      if (!error) assigned++;
    }

    return NextResponse.json({
      assigned,
      skipped_duplicate: skippedHandles.length,
      total: cleanHandles.length,
      handles_skipped: skippedHandles,
    });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
