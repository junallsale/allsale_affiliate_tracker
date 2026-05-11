import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateAndUploadContractPdf } from "@/lib/contract-service";

export const maxDuration = 60;

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export async function POST(request: NextRequest) {
  try {
    const { project_creator_id } = await request.json();
    if (!project_creator_id || typeof project_creator_id !== "string") {
      return NextResponse.json({ error: "project_creator_id required" }, { status: 400 });
    }

    const supabase = getServiceClient();
    const { data: pc, error } = await supabase
      .from("project_creators")
      .select("id, signed_at, contract_pdf_url")
      .eq("id", project_creator_id)
      .single();

    if (error || !pc) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (!pc.signed_at) {
      return NextResponse.json({ error: "not signed yet" }, { status: 400 });
    }
    if (pc.contract_pdf_url) {
      return NextResponse.json({ contract_pdf_url: pc.contract_pdf_url });
    }

    const { url } = await generateAndUploadContractPdf(supabase, project_creator_id);
    return NextResponse.json({ contract_pdf_url: url });
  } catch (err) {
    console.error("Contract regenerate error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
