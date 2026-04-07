import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServer } from "@/lib/supabase-server";
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
 * GET /api/creators/master
 * Query params: ?search=xxx&tier=1&category=beauty&limit=100
 */
export async function GET(req: NextRequest) {
  try {
    await requireAuth();
    const supabase = getServiceClient();
    const { searchParams } = new URL(req.url);

    let query = supabase
      .from("creator_master")
      .select("*")
      .order("gmv", { ascending: false, nullsFirst: false });

    const search = searchParams.get("search");
    if (search) query = query.ilike("handle", `%${search}%`);

    const tier = searchParams.get("tier");
    if (tier) query = query.eq("tier", parseInt(tier));

    const category = searchParams.get("category");
    if (category) query = query.eq("category", category);

    const gender = searchParams.get("gender");
    if (gender) query = query.eq("gender", gender);

    const limit = parseInt(searchParams.get("limit") || "200");
    query = query.limit(limit);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

/**
 * PATCH /api/creators/master
 * Body: { handle, gmv?, avg_view?, price_per_video?, category?, gender?, ... }
 * Updates creator_master AND inserts pricing_history record
 */
export async function PATCH(req: NextRequest) {
  try {
    await requireAuth();
    const supabase = getServiceClient();
    const body = await req.json();
    const { handle, ...updates } = body;

    if (!handle) return NextResponse.json({ error: "handle required" }, { status: 400 });

    const cleanHandle = handle.toLowerCase().replace(/^@/, "");

    // Auto-calculate tier
    if (updates.price_per_video != null || updates.avg_view != null || updates.gmv != null) {
      const { data: current } = await supabase
        .from("creator_master")
        .select("price_per_video, avg_view, gmv")
        .eq("handle", cleanHandle)
        .single();

      const ppv = updates.price_per_video ?? current?.price_per_video;
      const avgView = updates.avg_view ?? current?.avg_view;
      const gmv = updates.gmv ?? current?.gmv;

      if (ppv && avgView) {
        const tier = calculateTier(Number(ppv), Number(avgView), Number(gmv) || 0);
        if (tier !== null) updates.tier = tier;
      }
    }

    updates.updated_at = new Date().toISOString();

    // Upsert into creator_master
    const { data, error } = await supabase
      .from("creator_master")
      .upsert({ handle: cleanHandle, ...updates }, { onConflict: "handle" })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Insert pricing history
    const historyData: Record<string, unknown> = {
      creator_master_id: data.id,
      recorded_at: new Date().toISOString().split("T")[0],
      source: "manual",
    };
    if (updates.gmv != null) historyData.gmv = updates.gmv;
    if (updates.avg_view != null) historyData.avg_view = updates.avg_view;
    if (updates.followers != null) historyData.followers = updates.followers;
    if (updates.price_per_video != null) historyData.price_per_video = updates.price_per_video;
    if (updates.tier != null) historyData.tier = updates.tier;

    // Upsert to handle same-day updates
    await supabase.from("creator_pricing_history").upsert(historyData, {
      onConflict: "creator_master_id,recorded_at",
    });

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

/**
 * POST /api/creators/master
 * Body: { handle, email?, category?, ... }
 * Creates new creator_master record
 */
export async function POST(req: NextRequest) {
  try {
    await requireAuth();
    const supabase = getServiceClient();
    const body = await req.json();

    if (!body.handle) return NextResponse.json({ error: "handle required" }, { status: 400 });

    body.handle = body.handle.toLowerCase().replace(/^@/, "");

    const { data, error } = await supabase
      .from("creator_master")
      .upsert(body, { onConflict: "handle" })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
