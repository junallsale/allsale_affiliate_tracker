/**
 * Compose reply drafts based on email classification + project context
 */
import { createClient } from '@supabase/supabase-js';
import type { EmailClassification } from './email-classifier';
import {
  buildProductBriefItems,
  renderContentGuideSectionLi,
  renderContentGuideParagraph,
  type BriefItem,
} from './product-briefs';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

interface DraftContext {
  creatorName: string;
  brandName: string;
  contractLink: string;
  contractAmount: number;
  assignedVideoCount: number;
  commissionRate: number;
  advancePayment: number;
  productName: string;
  sampleLinksHtml: string;
  contentGuideUrl?: string;
  submissionDeadline?: string;
  briefItems: BriefItem[];
}

async function getProjectCreatorContext(projectCreatorId: string): Promise<DraftContext | null> {
  const supabase = getServiceClient();

  const { data: pc } = await supabase
    .from('project_creators')
    .select(`
      unique_slug, contract_amount, commission_rate, assigned_video_count, advance_payment,
      creator:creators(name, tiktok_handle),
      project:projects(id, name, submission_deadline, require_shipping_address, brand:brands(name)),
      project_creator_products:project_creator_products(product:products(id, name, content_guide_url, sample_invitation_url, sample_invitation_label, is_bundle))
    `)
    .eq('id', projectCreatorId)
    .single();

  if (!pc) return null;

  const creator = pc.creator as any;
  const project = pc.project as any;
  const brand = project?.brand as any;
  const products = (pc as any).project_creator_products || [];

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://allsale-affiliate-tracker.vercel.app';

  // Get sample links from assigned products
  let sampleLinksHtml = '';
  if (project && !project.require_shipping_address) {
    const productLinks = products
      .map((p: any) => p.product)
      .filter((p: any) => p?.sample_invitation_url)
      .map((p: any) => ({ url: p.sample_invitation_url, label: p.sample_invitation_label || p.name }));

    if (productLinks.length === 1) {
      sampleLinksHtml = `<li><strong>Sample invitation:</strong> <a href="${productLinks[0].url}">${productLinks[0].label}</a></li>`;
    } else if (productLinks.length > 1) {
      const items = productLinks.map((l: any) => `<a href="${l.url}">${l.label}</a>`).join(', ');
      sampleLinksHtml = `<li><strong>Sample invitation:</strong> ${items}</li>`;
    }
  }

  const contentGuideUrl = products[0]?.product?.content_guide_url || undefined;
  const productName = products[0]?.product?.name || '';
  const briefItems = await buildProductBriefItems(products, supabase);

  return {
    creatorName: creator?.name || creator?.tiktok_handle || 'Creator',
    brandName: brand?.name || '',
    contractLink: `${baseUrl}/c/${pc.unique_slug}`,
    contractAmount: pc.contract_amount || 0,
    assignedVideoCount: (pc as any).assigned_video_count || 1,
    commissionRate: (pc as any).commission_rate || 0,
    advancePayment: (pc as any).advance_payment || 0,
    productName,
    sampleLinksHtml,
    contentGuideUrl,
    submissionDeadline: project?.submission_deadline,
    briefItems,
  };
}

/** Build full campaign details HTML */
function campaignDetailsHtml(ctx: DraftContext): string {
  const lines = [
    `<li><strong>Rate:</strong> $${ctx.contractAmount} for ${ctx.assignedVideoCount} video(s)</li>`,
  ];
  if (ctx.productName) {
    lines.push(`<li><strong>Product:</strong> ${ctx.productName}</li>`);
  }
  const briefLi = renderContentGuideSectionLi(ctx.briefItems);
  if (briefLi) {
    lines.push(briefLi);
  }
  lines.push(`<li><strong>Sign the contract:</strong> <a href="${ctx.contractLink}">Contract & Submission Link</a></li>`);
  if (ctx.sampleLinksHtml) {
    lines.push(ctx.sampleLinksHtml);
  }
  return `<ul>${lines.join('\n')}</ul>`;
}

/** Compose a reply draft based on classification */
export async function composeDraft(
  classification: EmailClassification,
  projectCreatorId: string,
  originalSubject?: string
): Promise<{ subject: string; bodyHtml: string } | null> {
  const ctx = await getProjectCreatorContext(projectCreatorId);
  if (!ctx) return null;

  // Always use "Re: <original subject>" for threading
  const replySubject = originalSubject
    ? (originalSubject.toLowerCase().startsWith('re:') ? originalSubject : `Re: ${originalSubject}`)
    : null;

  switch (classification) {
    case 'price_negotiation':
      return {
        subject: replySubject || `Re: Collaboration with ${ctx.brandName}`,
        bodyHtml: `<p>Hi ${ctx.creatorName},</p>
<p>Thank you for your interest! Here are the details for our <strong>${ctx.brandName}</strong> campaign:</p>
${campaignDetailsHtml(ctx)}
<p>Let me know if you have any questions!</p>`,
      };

    case 'interest':
      return {
        subject: replySubject || `Re: Collaboration with ${ctx.brandName}`,
        bodyHtml: `<p>Hi ${ctx.creatorName},</p>
<p>Great to hear you're interested in collaborating with <strong>${ctx.brandName}</strong>!</p>
<p>Here are the campaign details:</p>
${campaignDetailsHtml(ctx)}
<p>Looking forward to working with you!</p>`,
      };

    case 'sample_request':
      return {
        subject: replySubject || `Re: Collaboration with ${ctx.brandName}`,
        bodyHtml: ctx.sampleLinksHtml
          ? `<p>Hi ${ctx.creatorName},</p>
<p>You can request your sample through the link below:</p>
<ul>${ctx.sampleLinksHtml}</ul>
<p>Let us know once you've received it!</p>`
          : `<p>Hi ${ctx.creatorName},</p>
<p>Thank you for reaching out about samples for <strong>${ctx.brandName}</strong>. We'll get back to you shortly with sample details.</p>`,
      };

    case 'content_brief': {
      const guideBlock = renderContentGuideParagraph(ctx.briefItems, ctx.brandName)
        || `<p>We'll share the content guidelines for <strong>${ctx.brandName}</strong> shortly.</p>`;
      return {
        subject: replySubject || `Re: Collaboration with ${ctx.brandName}`,
        bodyHtml: `<p>Hi ${ctx.creatorName},</p>
${guideBlock}
${ctx.submissionDeadline ? `<p>Submission deadline: <strong>${new Date(ctx.submissionDeadline).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</strong></p>` : ''}
<p>Let us know if you have any questions!</p>`,
      };
    }

    case 'contract_signed': {
      const advanceLine = ctx.advancePayment > 0
        ? `<p>Your advance payment of <strong>$${ctx.advancePayment}</strong> will be processed within 1 business day.</p>`
        : '';
      const contentGuideLine = renderContentGuideSectionLi(ctx.briefItems)
        .replace('<strong>Product brief:</strong>', '<strong>Content guide:</strong>')
        .replace('<strong>Product briefs:</strong>', '<strong>Content guides:</strong>');
      const deadlineLine = ctx.submissionDeadline
        ? `<li><strong>Submission deadline:</strong> ${new Date(ctx.submissionDeadline).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</li>`
        : '';
      return {
        subject: replySubject || `Re: Collaboration with ${ctx.brandName}`,
        bodyHtml: `<p>Hi ${ctx.creatorName},</p>
<p>Thank you for signing the contract and requesting the sample! We're excited to get started.</p>
${advanceLine}
<p>Here's what you need to create your content:</p>
<ul>
${contentGuideLine}
<li><strong>Submit your post:</strong> <a href="${ctx.contractLink}">Submission Link</a> — Please submit your TikTok post link here once it's live.</li>
${deadlineLine}
</ul>
<p>Let us know if you have any questions!</p>`,
      };
    }

    case 'payment_inquiry':
      return {
        subject: replySubject || `Re: Collaboration with ${ctx.brandName}`,
        bodyHtml: `<p>Hi ${ctx.creatorName},</p>
<p>Thank you for reaching out about payment. We'll check on the status and get back to you shortly.</p>
<p>For reference, your campaign rate is <strong>$${ctx.contractAmount}</strong> for ${ctx.assignedVideoCount} video(s).</p>`,
      };

    case 'posting_update':
      return {
        subject: replySubject || `Re: Collaboration with ${ctx.brandName}`,
        bodyHtml: `<p>Hi ${ctx.creatorName},</p>
<p>Thank you for the update! Please make sure to submit your TikTok post link through the submission page so we can process your remaining payment:</p>
<ul>
<li><strong>Submit your post:</strong> <a href="${ctx.contractLink}">Submission Link</a></li>
</ul>
<p>Once we've confirmed the post, the remaining balance will be processed. Thank you!</p>`,
      };

    case 'contract_modification':
    case 'shipping_info':
      return null;

    default:
      return null;
  }
}
