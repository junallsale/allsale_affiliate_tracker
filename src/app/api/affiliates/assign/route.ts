import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase-server";
import { generateSlug } from "@/lib/utils";

async function requireAuthClient() {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  return supabase;
}

function buildContractFields(aff: {
  planned_video_count?: number | null;
  price_per_video?: number | null;
  live_commission?: number | null;
  thread?: string | null;
}, advanceRatio: number) {
  const contractAmount = (aff.planned_video_count || 0) * (aff.price_per_video || 0);
  const advancePayment = Math.floor((contractAmount * advanceRatio) / 100);
  return {
    assigned_video_count: aff.planned_video_count || 0,
    contract_amount: contractAmount,
    advance_payment: advancePayment,
    remaining_payment: contractAmount - advancePayment,
    commission_rate: aff.live_commission || 20,
    communication_link: aff.thread || null,
    status: "pending" as const,
    ...(contractAmount === 0 ? { contract_sent: true, signed_at: new Date().toISOString() } : {}),
  };
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await requireAuthClient();
    const body = await request.json();

    const { affiliate_creator_ids, project_id, reactivate_ids = [] } = body;
    const reactivateSet = new Set<string>(reactivate_ids);

    if (!affiliate_creator_ids?.length || !project_id) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const { data: affiliates, error: fetchError } = await supabase
      .from("affiliate_creators")
      .select("*")
      .in("id", affiliate_creator_ids);

    if (fetchError || !affiliates?.length) {
      return NextResponse.json({ error: "Affiliate creators not found" }, { status: 404 });
    }

    const { data: projectRow } = await supabase
      .from("projects")
      .select("advance_ratio")
      .eq("id", project_id)
      .maybeSingle();
    const advanceRatio = projectRow?.advance_ratio ?? 0;

    const results = [];

    for (const aff of affiliates) {
      let creatorId: string;
      const { data: existingCreator } = await supabase
        .from("creators")
        .select("id")
        .eq("tiktok_handle", aff.handle)
        .maybeSingle();

      if (existingCreator) {
        creatorId = existingCreator.id;
      } else {
        const { data: newCreator, error: createError } = await supabase
          .from("creators")
          .insert({
            name: aff.handle,
            email: aff.email || "",
            tiktok_handle: aff.handle,
            slug: generateSlug(),
          })
          .select()
          .single();

        if (createError || !newCreator) {
          results.push({ handle: aff.handle, affiliate_creator_id: aff.id, error: "Failed to create creator" });
          continue;
        }
        creatorId = newCreator.id;
      }

      const { data: existingPc } = await supabase
        .from("project_creators")
        .select("id, is_deleted")
        .eq("project_id", project_id)
        .eq("creator_id", creatorId)
        .maybeSingle();

      if (existingPc && !existingPc.is_deleted) {
        results.push({ handle: aff.handle, affiliate_creator_id: aff.id, status: "already_assigned" });
        continue;
      }

      if (existingPc && existingPc.is_deleted) {
        if (!reactivateSet.has(aff.id)) {
          results.push({ handle: aff.handle, affiliate_creator_id: aff.id, status: "deleted_in_project" });
          continue;
        }
        const { error: reError } = await supabase
          .from("project_creators")
          .update({ is_deleted: false, ...buildContractFields(aff, advanceRatio) })
          .eq("id", existingPc.id);
        results.push(reError
          ? { handle: aff.handle, affiliate_creator_id: aff.id, error: reError.message }
          : { handle: aff.handle, affiliate_creator_id: aff.id, status: "reactivated" });
        continue;
      }

      const { error: pcError } = await supabase
        .from("project_creators")
        .insert({
          project_id,
          creator_id: creatorId,
          unique_slug: generateSlug(),
          ...buildContractFields(aff, advanceRatio),
        });

      if (pcError) {
        results.push({ handle: aff.handle, affiliate_creator_id: aff.id, error: pcError.message });
      } else {
        results.push({ handle: aff.handle, affiliate_creator_id: aff.id, status: "assigned" });
      }
    }

    return NextResponse.json({ results }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
