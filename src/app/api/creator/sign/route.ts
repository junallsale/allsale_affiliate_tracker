import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateContractHash, generateContractPdf, type ContractData } from "@/lib/contract-pdf";
import { sendGmailEmail, getAccessToken, type EmailAttachment } from "@/lib/gmail";

export const maxDuration = 60;

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
    const contractEmail = formData.get("contract_email") as string;
    const file = formData.get("signature") as File;
    const paymentMethod = (formData.get("payment_method") as string) || 'paypal';
    const achAccountName = formData.get("ach_account_name") as string | null;
    const achBankName = formData.get("ach_bank_name") as string | null;
    const achAccountNumber = formData.get("ach_account_number") as string | null;
    const achBeneficiaryAddress = formData.get("ach_beneficiary_address") as string | null;
    const achRoutingNumber = formData.get("ach_routing_number") as string | null;

    const isAch = paymentMethod === 'ach';
    if (!projectCreatorId || !legalName?.trim() || !file) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!isAch && !paymentEmail?.trim()) {
      return NextResponse.json({ error: "Payment email required for PayPal" }, { status: 400 });
    }
    if (isAch && (!achAccountName?.trim() || !achBankName?.trim() || !achAccountNumber?.trim())) {
      return NextResponse.json({ error: "Bank details required for ACH" }, { status: 400 });
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

    const signedAt = new Date().toISOString();
    const resolvedContractEmail = (contractEmail || paymentEmail).trim();

    // Update project_creators record
    const updateData: Record<string, unknown> = {
      legal_name: legalName.trim(),
      payment_method: paymentMethod,
      contract_email: resolvedContractEmail,
      signature_url: signaturePublicUrl,
      signed_at: signedAt,
    };
    if (isAch) {
      updateData.ach_account_name = achAccountName?.trim() || null;
      updateData.ach_bank_name = achBankName?.trim() || null;
      updateData.ach_account_number = achAccountNumber?.trim() || null;
      updateData.ach_routing_number = achRoutingNumber?.trim() || null;
      updateData.ach_beneficiary_address = achBeneficiaryAddress?.trim() || null;
      updateData.payment_email = null;
    } else {
      updateData.payment_email = paymentEmail.trim();
      updateData.ach_account_name = null;
      updateData.ach_bank_name = null;
      updateData.ach_account_number = null;
      updateData.ach_routing_number = null;
      updateData.ach_beneficiary_address = null;
    }
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

    // ── Generate contract PDF + send email ──
    try {
      await generateAndSendContract(supabase, projectCreatorId, {
        legalName: legalName.trim(),
        paymentEmail: isAch ? '' : paymentEmail.trim(),
        contractEmail: resolvedContractEmail,
        signatureUrl: signaturePublicUrl,
        signedAt,
        shippingName: shippingName?.trim(),
        shippingAddress: shippingAddress?.trim(),
        paymentMethod: paymentMethod as 'paypal' | 'ach',
        achAccountName: achAccountName?.trim(),
        achBankName: achBankName?.trim(),
        achAccountNumber: achAccountNumber?.trim(),
        achBeneficiaryAddress: achBeneficiaryAddress?.trim(),
        achRoutingNumber: achRoutingNumber?.trim(),
      });
    } catch (err) {
      console.error("Contract PDF/email error:", err);
      // Don't fail the signing — PDF/email is best-effort
    }

    return NextResponse.json({ signature_url: signaturePublicUrl });
  } catch (err) {
    console.error("Error saving signature:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function generateAndSendContract(
  supabase: ReturnType<typeof getServiceClient>,
  projectCreatorId: string,
  params: {
    legalName: string;
    paymentEmail: string;
    contractEmail: string;
    signatureUrl: string;
    signedAt: string;
    shippingName?: string;
    shippingAddress?: string;
    paymentMethod?: 'paypal' | 'ach';
    achAccountName?: string;
    achBankName?: string;
    achAccountNumber?: string;
    achBeneficiaryAddress?: string;
    achRoutingNumber?: string;
  }
) {
  // Fetch full project_creator data
  const { data: pc } = await supabase
    .from("project_creators")
    .select(`
      id, contract_amount, advance_payment, remaining_payment, commission_rate,
      assigned_video_count, content_type, contract_notes,
      creator:creators(name, tiktok_handle, email),
      project:projects(name, submission_deadline, brand:brands(name)),
      project_creator_products:project_creator_products(product:products(name))
    `)
    .eq("id", projectCreatorId)
    .single();

  if (!pc) return;

  const creator = pc.creator as any;
  const project = (pc as any).project as any;
  const brand = project?.brand as any;
  const products = ((pc as any).project_creator_products || []).map((p: any) => p.product?.name).filter(Boolean);

  const contractData: ContractData = {
    projectCreatorId,
    legalName: params.legalName,
    paymentEmail: params.paymentEmail,
    contractEmail: params.contractEmail,
    creatorHandle: creator?.tiktok_handle || '',
    brandName: brand?.name || '',
    projectName: project?.name || '',
    contentType: (pc as any).content_type || 'shoppable_video',
    assignedVideoCount: (pc as any).assigned_video_count || 1,
    products,
    contractAmount: pc.contract_amount || 0,
    advancePayment: pc.advance_payment || 0,
    remainingPayment: pc.remaining_payment || 0,
    commissionRate: (pc as any).commission_rate || 0,
    uploadDeadline: project?.submission_deadline,
    signedAt: params.signedAt,
    signatureUrl: params.signatureUrl,
    shippingName: params.shippingName,
    shippingAddress: params.shippingAddress,
    contractNotes: (pc as any).contract_notes || undefined,
    paymentMethod: params.paymentMethod || 'paypal',
    achAccountName: params.achAccountName,
    achBankName: params.achBankName,
    achAccountNumber: params.achAccountNumber,
    achBeneficiaryAddress: params.achBeneficiaryAddress,
    achRoutingNumber: params.achRoutingNumber,
  };

  // Generate hash
  const contractHash = generateContractHash(contractData);

  // Generate PDF
  const pdfBuffer = await generateContractPdf(contractData, contractHash);

  // Upload PDF to storage
  const pdfFileName = `contracts/${projectCreatorId}_${Date.now()}.pdf`;
  await supabase.storage
    .from("invoices")
    .upload(pdfFileName, pdfBuffer, { contentType: "application/pdf", upsert: true });

  const { data: pdfUrlData } = supabase.storage.from("invoices").getPublicUrl(pdfFileName);

  // Save hash and PDF URL
  await supabase
    .from("project_creators")
    .update({ contract_hash: contractHash, contract_pdf_url: pdfUrlData.publicUrl })
    .eq("id", projectCreatorId);

  // Send email with PDF attachment
  const { data: emailAccount } = await supabase
    .from("email_accounts")
    .select("email, gmail_refresh_token")
    .eq("email", "rosters@allsale.ai")
    .single();

  if (!emailAccount) {
    // Fallback: try any active account
    const { data: anyAccount } = await supabase
      .from("email_accounts")
      .select("email, gmail_refresh_token")
      .eq("is_active", true)
      .limit(1)
      .single();
    if (!anyAccount) return;
    Object.assign(emailAccount || {}, anyAccount);
  }

  const senderAccount = emailAccount!;
  const threadRef = projectCreatorId.slice(0, 8).toUpperCase();

  const attachment: EmailAttachment = {
    filename: `Agreement_${brand?.name || 'ALLSALE'}_${creator?.tiktok_handle || 'creator'}.pdf`,
    mimeType: "application/pdf",
    data: pdfBuffer,
  };

  await sendGmailEmail({
    refreshToken: senderAccount.gmail_refresh_token,
    from: senderAccount.email,
    to: params.contractEmail,
    cc: "rosters@allsale.ai",
    subject: `Your Agreement with ${brand?.name || 'ALLSALE'} is Confirmed [#${threadRef}]`,
    bodyHtml: `<p>Hi ${params.legalName},</p>
<p>Thank you for signing the agreement for the <strong>${brand?.name}</strong> campaign!</p>
<p>Please find your signed contract attached as a PDF for your records.</p>
<p>If you have any questions, feel free to reply to this email.</p>
<p>Best regards,<br>ALLSALE Team</p>`,
    attachments: [attachment],
  });

  // Record the email
  await supabase.from("email_messages").insert({
    project_creator_id: projectCreatorId,
    direction: "outbound",
    from_email: senderAccount.email,
    to_email: params.contractEmail,
    cc_emails: "rosters@allsale.ai",
    subject: `Your Agreement with ${brand?.name || 'ALLSALE'} is Confirmed [#${threadRef}]`,
    body_html: "Contract confirmation with PDF attachment",
    sent_at: new Date().toISOString(),
  });
}
