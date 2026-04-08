/**
 * Contract PDF generation using PDFKit
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

/** Generate contract PDF as Buffer */
export async function generateContractPdf(data: ContractData, contractHash: string): Promise<Buffer> {
  // Dynamic import for PDFKit (Node.js only)
  const PDFDocument = (await import('pdfkit')).default;

  return new Promise<Buffer>(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'LETTER', margin: 60 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ── Header ──
      doc.fontSize(20).font('Helvetica-Bold').text('ALLSALE', { align: 'center' });
      doc.fontSize(11).font('Helvetica').text('Affiliate Creator Agreement', { align: 'center' });
      doc.moveDown(0.5);
      doc.moveTo(60, doc.y).lineTo(552, doc.y).stroke('#cccccc');
      doc.moveDown(1);

      // ── Parties ──
      doc.fontSize(12).font('Helvetica-Bold').text('Parties');
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica');
      doc.text(`Brand: ${data.brandName}`);
      doc.text(`Creator: ${data.legalName} (@${data.creatorHandle})`);
      doc.text(`Project: ${data.projectName}`);
      doc.moveDown(1);

      // ── Deliverables ──
      doc.fontSize(12).font('Helvetica-Bold').text('Deliverables');
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica');
      doc.text(`Content Type: ${data.contentType === 'shoppable_video' ? 'Shoppable Video' : 'LIVE Shopping'}`);
      doc.text(`Number of Videos: ${data.assignedVideoCount}`);
      if (data.products.length > 0) {
        doc.text(`Products: ${data.products.join(', ')}`);
      }
      if (data.uploadDeadline) {
        doc.text(`Upload Deadline: ${new Date(data.uploadDeadline).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`);
      }
      doc.moveDown(1);

      // ── Compensation ──
      doc.fontSize(12).font('Helvetica-Bold').text('Compensation');
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica');
      doc.text(`Total Fee: $${data.contractAmount.toLocaleString()}`);
      doc.text(`Advance Payment: $${data.advancePayment.toLocaleString()} (paid within 3 business days of signing)`);
      doc.text(`Remaining Payment: $${data.remainingPayment.toLocaleString()} (paid within 3 business days after content submission)`);
      if (data.commissionRate > 0) {
        doc.text(`Commission Rate: ${data.commissionRate}% of GMV`);
      }
      doc.text(`Payment Method: PayPal (${data.paymentEmail})`);
      doc.moveDown(1);

      // ── Terms ──
      doc.fontSize(12).font('Helvetica-Bold').text('Terms & Conditions');
      doc.moveDown(0.3);
      doc.fontSize(9).font('Helvetica');
      doc.text('1. Creator agrees to produce and deliver the specified content according to the brand\'s content guidelines.');
      doc.text('2. Creator grants the brand permission to use the content for promotional purposes including Spark Ads.');
      doc.text('3. Creator is responsible for all applicable taxes on compensation received.');
      doc.text('4. Either party may terminate this agreement with written notice. Compensation will be prorated for completed work.');
      doc.text('5. All content must comply with TikTok\'s community guidelines and FTC disclosure requirements.');
      doc.moveDown(1.5);

      // ── Signature ──
      doc.fontSize(12).font('Helvetica-Bold').text('Signature');
      doc.moveDown(0.3);

      // Try to embed signature image
      try {
        const sigRes = await fetch(data.signatureUrl);
        if (sigRes.ok) {
          const sigBuffer = Buffer.from(await sigRes.arrayBuffer());
          doc.image(sigBuffer, { width: 200, height: 60 });
        }
      } catch {
        doc.fontSize(10).font('Helvetica-Oblique').text('[Signature on file]');
      }

      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica');
      doc.text(`Name: ${data.legalName}`);
      doc.text(`Date: ${new Date(data.signedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}`);
      doc.text(`Email: ${data.contractEmail}`);
      doc.moveDown(2);

      // ── Document Hash ──
      doc.moveTo(60, doc.y).lineTo(552, doc.y).stroke('#cccccc');
      doc.moveDown(0.5);
      doc.fontSize(7).font('Helvetica').fillColor('#888888');
      doc.text(`Document Integrity Hash (SHA-256): ${contractHash}`, { align: 'center' });
      doc.text('This hash verifies that the contract contents have not been altered since signing.', { align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
