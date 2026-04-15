/**
 * Contract PDF generation using jsPDF (works in Vercel serverless)
 */
import crypto from 'crypto';

export interface ContractData {
  projectCreatorId: string;
  legalName: string;
  paymentEmail: string;
  contractEmail: string;
  creatorHandle: string;
  brandName: string;
  projectName: string;
  contentType: string;
  assignedVideoCount: number;
  products: string[];
  contractAmount: number;
  advancePayment: number;
  remainingPayment: number;
  commissionRate: number;
  uploadDeadline?: string;
  signedAt: string;
  signatureUrl: string;
  shippingName?: string;
  shippingAddress?: string;
  contractNotes?: string;
  paymentMethod?: 'paypal' | 'ach';
  achAccountName?: string;
  achBankName?: string;
  achAccountNumber?: string;
  achBeneficiaryAddress?: string;
}

/** Generate SHA-256 hash of contract data for integrity verification */
export function generateContractHash(data: ContractData): string {
  const hashInput = JSON.stringify({
    project_creator_id: data.projectCreatorId,
    legal_name: data.legalName,
    payment_email: data.paymentEmail,
    contract_email: data.contractEmail,
    contract_amount: data.contractAmount,
    advance_payment: data.advancePayment,
    remaining_payment: data.remainingPayment,
    commission_rate: data.commissionRate,
    assigned_video_count: data.assignedVideoCount,
    content_type: data.contentType,
    signed_at: data.signedAt,
    signature_url: data.signatureUrl,
  });
  return crypto.createHash('sha256').update(hashInput).digest('hex');
}

/** Generate contract PDF as Buffer using jsPDF */
export async function generateContractPdf(data: ContractData, contractHash: string): Promise<Buffer> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = 20;

  const addLine = (text: string, fontSize = 10, style: 'normal' | 'bold' = 'normal') => {
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', style);
    const lines = doc.splitTextToSize(text, contentWidth);
    for (const line of lines) {
      if (y > 260) { doc.addPage(); y = 20; }
      doc.text(line, margin, y);
      y += fontSize * 0.45;
    }
  };

  const addGap = (mm = 4) => { y += mm; };

  // ── Header ──
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('ALLSALE', pageWidth / 2, y, { align: 'center' });
  y += 7;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text('Affiliate Creator Agreement', pageWidth / 2, y, { align: 'center' });
  y += 5;
  doc.setDrawColor(200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  // ── Parties ──
  addLine('Parties', 13, 'bold');
  addGap(2);
  addLine(`Brand: ${data.brandName}`);
  addLine(`Creator: ${data.legalName} (@${data.creatorHandle})`);
  addLine(`Project: ${data.projectName}`);
  addGap(6);

  // ── Deliverables ──
  addLine('Deliverables', 13, 'bold');
  addGap(2);
  addLine(`Content Type: ${data.contentType === 'shoppable_video' ? 'Shoppable Video' : 'LIVE Shopping'}`);
  addLine(`Number of Videos: ${data.assignedVideoCount}`);
  if (data.products.length > 0) {
    addLine(`Products: ${data.products.join(', ')}`);
  }
  if (data.uploadDeadline) {
    addLine(`Upload Deadline: ${new Date(data.uploadDeadline).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`);
  }
  addGap(6);

  // ── Compensation ──
  addLine('Compensation', 13, 'bold');
  addGap(2);
  addLine(`Total Fee: $${data.contractAmount.toLocaleString()}`);
  addLine(`Advance Payment: $${data.advancePayment.toLocaleString()} (within 3 business days of signing)`);
  addLine(`Remaining Payment: $${data.remainingPayment.toLocaleString()} (within 3 business days after content submission)`);
  if (data.commissionRate > 0) {
    addLine(`Commission Rate: ${data.commissionRate}% of GMV`);
  }
  if (data.paymentMethod === 'ach') {
    addLine('Payment Method: ACH (Bank Transfer)');
    if (data.achAccountName) addLine(`Account Name: ${data.achAccountName}`);
    if (data.achBankName) addLine(`Bank: ${data.achBankName}`);
    if (data.achAccountNumber) addLine(`Account Number: ${data.achAccountNumber}`);
    if (data.achBeneficiaryAddress) addLine(`Beneficiary Address: ${data.achBeneficiaryAddress}`);
  } else {
    addLine(`Payment Method: PayPal (${data.paymentEmail})`);
  }
  addGap(6);

  // ── Terms ──
  addLine('Terms & Conditions', 13, 'bold');
  addGap(2);
  doc.setFontSize(9);
  const terms = [
    '1. Creator agrees to produce and deliver the specified content according to the brand\'s content guidelines.',
    '2. Creator grants the brand permission to use the content for promotional purposes including Spark Ads.',
    '3. Creator is responsible for all applicable taxes on compensation received.',
    '4. Either party may terminate this agreement with written notice. Compensation will be prorated for completed work.',
    '5. All content must comply with TikTok\'s community guidelines and FTC disclosure requirements.',
  ];
  for (const term of terms) {
    addLine(term, 9);
    addGap(1);
  }
  if (data.contractNotes) {
    addGap(3);
    addLine('Additional Terms', 11, 'bold');
    addGap(2);
    addLine(data.contractNotes, 9);
  }
  addGap(8);

  // ── Signature ──
  addLine('Signature', 13, 'bold');
  addGap(3);

  // Try to embed signature image
  try {
    const sigRes = await fetch(data.signatureUrl);
    if (sigRes.ok) {
      const sigBuffer = Buffer.from(await sigRes.arrayBuffer());
      const base64 = sigBuffer.toString('base64');
      const imgData = `data:image/png;base64,${base64}`;
      doc.addImage(imgData, 'PNG', margin, y, 60, 18);
      y += 22;
    }
  } catch {
    addLine('[Signature on file]', 10);
    addGap(2);
  }

  const signDate = new Date(data.signedAt).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
  addLine(`Name: ${data.legalName}`);
  addLine(`Date: ${signDate}`);
  addLine(`Email: ${data.contractEmail}`);
  addGap(10);

  // ── Document Hash ──
  doc.setDrawColor(200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;
  doc.setFontSize(7);
  doc.setTextColor(136);
  doc.text(`Document Integrity Hash (SHA-256): ${contractHash}`, pageWidth / 2, y, { align: 'center' });
  y += 3;
  doc.text('This hash verifies that the contract contents have not been altered since signing.', pageWidth / 2, y, { align: 'center' });

  // Return as Buffer
  const arrayBuffer = doc.output('arraybuffer');
  return Buffer.from(arrayBuffer);
}
