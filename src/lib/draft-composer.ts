/**
 * Compose reply drafts based on email classification + project context
 */
import { createClient } from '@supabase/supabase-js';
import type { EmailClassification } from './email-classifier';

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
  productName: string;
  sampleLinksHtml: string;
  contentGuideUrl?: string;
  submissionDeadline?: string;
}

async function getProjectCreatorContext(projectCreatorId: string): Promise<DraftContext | null> {
  const supabase = getServiceClient();

  const { data: pc } = await supabase
    .from('project_creators')
    .select(`
      unique_slug, contract_amount, commission_rate, assigned_video_count,
      creator:creators(name, tiktok_handle),
      project:projects(id, name, submission_deadline, require_shipping_address, brand:brands(name)),
      project_creator_products:project_creator_products(product:products(name, content_guide_url))
    `)
    .eq('id', projectCreatorId)
    .single();

  if (!pc) return null;

  const creator = pc.creator as any;
  const project = pc.project as any;
  const brand = project?.brand as any;
  const products = (pc as any).project_creator_products || [];

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://allsale-affiliate-tracker.vercel.app';

  // Get all active sample links
  let sampleLinksHtml = '';
  if (project && !project.require_shipping_address) {
    const { data: links } = await supabase
      .from('sample_invitation_links')
      .select('url, label')
      .eq('project_id', project.id)
      .eq('is_active', true)
      .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString());

    if (links?.length) {
      if (links.length === 1) {
        sampleLinksHtml = `<li><strong>Sample invitation:</strong> <a href="${links[0].url}">${links[0].label || 'Request Sample'}</a></li>`;
      } else {
        const items = links.map(l => `<a href="${l.url}">${l.label || l.url}</a>`).join(', ');
        sampleLinksHtml = `<li><strong>Sample invitation:</strong> ${items}</li>`;
      }
    }
  }

  const contentGuideUrl = products[0]?.product?.content_guide_url || undefined;
  const productName = products[0]?.product?.name || '';

  return {
    creatorName: creator?.name || creator?.tiktok_handle || 'Creator',
    brandName: brand?.name || '',
    contractLink: `${baseUrl}/c/${pc.unique_slug}`,
    contractAmount: pc.contract_amount || 0,
    assignedVideoCount: (pc as any).assigned_video_count || 1,
    commissionRate: (pc as any).commission_rate || 0,
    productName,
    sampleLinksHtml,
    contentGuideUrl,
    submissionDeadline: project?.submission_deadline,
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
  if (ctx.contentGuideUrl) {
    lines.push(`<li><strong>Product brief:</strong> <a href="${ctx.contentGuideUrl}">Content Guide</a></li>`);
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

    case 'content_brief':
      return {
        subject: replySubject || `Re: Collaboration with ${ctx.brandName}`,
        bodyHtml: `<p>Hi ${ctx.creatorName},</p>
${ctx.contentGuideUrl
  ? `<p>Here's the content guide for your <strong>${ctx.brandName}</strong> campaign: <a href="${ctx.contentGuideUrl}">Content Guide</a></p>`
  : `<p>We'll share the content guidelines for <strong>${ctx.brandName}</strong> shortly.</p>`
}
${ctx.submissionDeadline ? `<p>Submission deadline: <strong>${new Date(ctx.submissionDeadline).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</strong></p>` : ''}
<p>Let us know if you have any questions!</p>`,
      };

    case 'contract_modification':
    case 'shipping_info':
      return null;

    default:
      return null;
  }
}
