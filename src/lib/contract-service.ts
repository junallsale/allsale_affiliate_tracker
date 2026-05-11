import type { SupabaseClient } from "@supabase/supabase-js";
import { generateContractHash, generateContractPdf, type ContractData } from "@/lib/contract-pdf";

export interface ContractGenerationResult {
  url: string;
  hash: string;
  pdfBuffer: Buffer;
  contractData: ContractData;
  brandName: string;
  creatorHandle: string;
  creatorName: string;
  creatorEmail: string | null;
  contractEmail: string;
}

export async function generateAndUploadContractPdf(
  supabase: SupabaseClient,
  projectCreatorId: string,
): Promise<ContractGenerationResult> {
  const { data: pc, error } = await supabase
    .from("project_creators")
    .select(`
      id, contract_amount, advance_payment, remaining_payment, commission_rate,
      assigned_video_count, content_type, contract_notes, live_hours,
      legal_name, payment_email, contract_email, signature_url, signed_at,
      payment_method, ach_account_name, ach_bank_name, ach_account_number,
      ach_routing_number, ach_beneficiary_address,
      shipping_name, shipping_address,
      creator:creators(name, tiktok_handle, email),
      project:projects(name, submission_deadline, require_draft_review, brand:brands(name)),
      project_creator_products:project_creator_products(product:products(name, content_guide_url))
    `)
    .eq("id", projectCreatorId)
    .single();

  if (error || !pc) {
    throw new Error(`project_creator not found: ${projectCreatorId}`);
  }
  if (!pc.signed_at || !pc.signature_url || !pc.legal_name) {
    throw new Error("contract is not signed yet");
  }

  const creator = pc.creator as any;
  const project = (pc as any).project as any;
  const brand = project?.brand as any;
  const pcProducts = ((pc as any).project_creator_products || [])
    .map((p: any) => p.product)
    .filter(Boolean);
  const products: string[] = pcProducts.map((p: any) => p.name).filter(Boolean);
  const productGuideUrls = pcProducts
    .filter((p: any) => p.name && p.content_guide_url)
    .map((p: any) => ({ name: p.name, url: p.content_guide_url }));

  const paymentMethod = ((pc as any).payment_method || "paypal") as "paypal" | "ach";
  const resolvedContractEmail =
    (pc as any).contract_email ||
    creator?.email ||
    (pc as any).payment_email ||
    "";

  const contractData: ContractData = {
    projectCreatorId,
    legalName: (pc as any).legal_name,
    paymentEmail: paymentMethod === "ach" ? "" : ((pc as any).payment_email || ""),
    contractEmail: resolvedContractEmail,
    creatorHandle: creator?.tiktok_handle || "",
    brandName: brand?.name || "",
    projectName: project?.name || "",
    contentType: (pc as any).content_type || "shoppable_video",
    assignedVideoCount: (pc as any).assigned_video_count || 1,
    products,
    contractAmount: Number((pc as any).contract_amount) || 0,
    advancePayment: Number((pc as any).advance_payment) || 0,
    remainingPayment: Number((pc as any).remaining_payment) || 0,
    commissionRate: Number((pc as any).commission_rate) || 0,
    uploadDeadline: project?.submission_deadline,
    signedAt: (pc as any).signed_at,
    signatureUrl: (pc as any).signature_url,
    shippingName: (pc as any).shipping_name || undefined,
    shippingAddress: (pc as any).shipping_address || undefined,
    contractNotes: (pc as any).contract_notes || undefined,
    paymentMethod,
    achAccountName: (pc as any).ach_account_name || undefined,
    achBankName: (pc as any).ach_bank_name || undefined,
    achAccountNumber: (pc as any).ach_account_number || undefined,
    achBeneficiaryAddress: (pc as any).ach_beneficiary_address || undefined,
    achRoutingNumber: (pc as any).ach_routing_number || undefined,
    liveHours: (pc as any).live_hours || undefined,
    requireDraftReview: project?.require_draft_review || false,
    productGuideUrls:
      project?.require_draft_review && productGuideUrls.length > 0 ? productGuideUrls : undefined,
  };

  const contractHash = generateContractHash(contractData);
  const pdfBuffer = await generateContractPdf(contractData, contractHash);

  const pdfFileName = `contracts/${projectCreatorId}_${Date.now()}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from("invoices")
    .upload(pdfFileName, pdfBuffer, { contentType: "application/pdf", upsert: true });

  if (uploadError) {
    throw new Error(`PDF upload failed: ${uploadError.message}`);
  }

  const { data: pdfUrlData } = supabase.storage.from("invoices").getPublicUrl(pdfFileName);
  const pdfUrl = pdfUrlData.publicUrl;

  const { error: updateError } = await supabase
    .from("project_creators")
    .update({ contract_hash: contractHash, contract_pdf_url: pdfUrl })
    .eq("id", projectCreatorId);

  if (updateError) {
    throw new Error(`Failed to save contract URL: ${updateError.message}`);
  }

  return {
    url: pdfUrl,
    hash: contractHash,
    pdfBuffer,
    contractData,
    brandName: brand?.name || "",
    creatorHandle: creator?.tiktok_handle || "",
    creatorName: creator?.name || "",
    creatorEmail: creator?.email || null,
    contractEmail: resolvedContractEmail,
  };
}
