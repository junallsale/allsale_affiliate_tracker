import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServer } from "@/lib/supabase-server";
import { generateSlug } from "@/lib/utils";
import { enrichAfterInsert } from "@/lib/enrich-affiliates";
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

export async function GET() {
  try {
    await requireAuth();
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from("affiliate_creators")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAuth();
    const supabase = getServiceClient();
    const body = await request.json();

    // Remove contract_amount (generated column)
    delete body.contract_amount;
    delete body.id;
    delete body.created_at;
    delete body.updated_at;

    const { data, error } = await supabase
      .from("affiliate_creators")
      .insert(body)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Auto-enrich with TikTok data (fire-and-forget)
    if (data && data.handle) {
      enrichAfterInsert([{ id: data.id, handle: data.handle }]);
    }

    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = getServiceClient();
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    // Allow anonymous PATCH for confirmation_status only
    const isConfirmationOnly = Object.keys(updates).length === 1 && 'confirmation_status' in updates;
    if (!isConfirmationOnly) {
      await requireAuth();
    }

    // Remove readonly fields
    delete updates.created_at;
    updates.updated_at = new Date().toISOString();

    // Auto-calculate tier when price_per_video changes
    if (updates.price_per_video != null) {
      const { data: current } = await supabase
        .from("affiliate_creators")
        .select("avg_view, gmv")
        .eq("id", id)
        .single();

      if (current) {
        const tier = calculateTier(
          Number(updates.price_per_video),
          current.avg_view || 0,
          current.gmv || 0
        );
        if (tier !== null) updates.tier = tier;
      }
    }

    // If setting status to Confirmed, validate brand_id and project_id
    if (updates.status === "Confirmed") {
      // First fetch current affiliate data
      const { data: current } = await supabase
        .from("affiliate_creators")
        .select("*")
        .eq("id", id)
        .single();

      if (!current) {
        return NextResponse.json({ error: "Affiliate not found" }, { status: 404 });
      }

      const brandId = updates.brand_id || current.brand_id;
      const projectId = updates.project_id || current.project_id;

      if (!brandId) {
        return NextResponse.json({ error: "Please select a brand first" }, { status: 400 });
      }
      if (!projectId) {
        return NextResponse.json({ error: "Please select a project first" }, { status: 400 });
      }

      // Auto-create project_creator
      const handle = current.handle;
      let creatorId: string;

      // Check if creator exists
      const { data: existingCreator } = await supabase
        .from("creators")
        .select("id")
        .eq("tiktok_handle", handle)
        .maybeSingle();

      if (existingCreator) {
        creatorId = existingCreator.id;
      } else {
        // Strip leading @ from handle for tiktok_handle
        const cleanHandle = handle.replace(/^@+/, '');
        const { data: newCreator, error: createError } = await supabase
          .from("creators")
          .insert({
            name: cleanHandle,
            email: current.email || "",
            tiktok_handle: cleanHandle,
            slug: generateSlug(),
          })
          .select()
          .single();

        if (createError || !newCreator) {
          console.error("Failed to create creator:", createError);
          return NextResponse.json({ error: `Failed to create creator: ${createError?.message}` }, { status: 500 });
        }
        creatorId = newCreator.id;
      }

      // Check if project_creator already exists
      const { data: existingPc } = await supabase
        .from("project_creators")
        .select("id")
        .eq("project_id", projectId)
        .eq("creator_id", creatorId)
        .maybeSingle();

      if (!existingPc) {
        const contractAmount = current.contract_amount || (current.planned_video_count || 0) * (current.price_per_video || 0);
        const advancePayment = Math.floor(contractAmount / 2);
        const { error: pcError } = await supabase
          .from("project_creators")
          .insert({
            project_id: projectId,
            creator_id: creatorId,
            unique_slug: generateSlug(),
            assigned_video_count: current.planned_video_count || 1,
            content_type: "shoppable_video",
            contract_amount: contractAmount,
            advance_payment: advancePayment,
            remaining_payment: contractAmount - advancePayment,
            commission_rate: current.live_commission || 20,
            communication_link: current.thread || null,
            status: "pending",
            ...(contractAmount === 0 ? { contract_sent: true, signed_at: new Date().toISOString() } : {}),
          });

        if (pcError) {
          console.error("Failed to create project_creator:", pcError);
        }
      }
    }

    const { data, error } = await supabase
      .from("affiliate_creators")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireAuth();
    const supabase = getServiceClient();
    const body = await request.json();
    const { ids } = body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "Missing ids array" }, { status: 400 });
    }

    const { error } = await supabase
      .from("affiliate_creators")
      .delete()
      .in("id", ids);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
