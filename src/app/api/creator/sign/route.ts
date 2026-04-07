import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const projectCreatorId = formData.get("project_creator_id") as string;
    const legalName = formData.get("legal_name") as string;
    const paymentEmail = formData.get("payment_email") as string;
    const file = formData.get("signature") as File;

    if (!projectCreatorId || !legalName?.trim() || !paymentEmail?.trim() || !file) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const supabase = getServiceClient();

    // Upload signature to storage
    const fileName = `signatures/${projectCreatorId}_${Date.now()}.png`;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from("invoices")
      .upload(fileName, buffer, { contentType: "image/png", upsert: true });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data: urlData } = supabase.storage.from("invoices").getPublicUrl(fileName);
    const signaturePublicUrl = urlData.publicUrl;

    // Shipping details (optional)
    const shippingName = formData.get("shipping_name") as string | null;
    const shippingAddress = formData.get("shipping_address") as string | null;
    const shippingPhone = formData.get("shipping_phone") as string | null;

    // Update project_creators record
    const updateData: Record<string, unknown> = {
      legal_name: legalName.trim(),
      payment_email: paymentEmail.trim(),
      signature_url: signaturePublicUrl,
      signed_at: new Date().toISOString(),
    };
    if (shippingName) updateData.shipping_name = shippingName.trim();
    if (shippingAddress) updateData.shipping_address = shippingAddress.trim();
    if (shippingPhone) updateData.shipping_phone = shippingPhone.trim();

    const { error: updateError } = await supabase
      .from("project_creators")
      .update(updateData)
      .eq("id", projectCreatorId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ signature_url: signaturePublicUrl });
  } catch (err) {
    console.error("Error saving signature:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
