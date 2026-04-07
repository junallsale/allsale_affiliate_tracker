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
  projectName: string;
  brandName: string;
  contractLink: string;
  contractAmount: number;
  commissionRate: number;
  sampleLink?: string;
  contentGuideUrl?: string;
  submissionDeadline?: string;
}

async function getProjectCreatorContext(projectCreatorId: string): Promise<DraftContext | null> {
  const supabase = getServiceClient();

  const { data: pc } = await supabase
    .from('project_creators')
    .select(`
      unique_slug, contract_amount, commission_rate,
      creator:creators(name, tiktok_handle),
      project:projects(id, name, submission_deadline, require_shipping_address, brand:brands(name)),
      project_creator_products:project_creator_products(product:products(content_guide_url))
    `)
    .eq('id', projectCreatorId)
    .single();

  if (!pc) return null;

  const creator = pc.creator as any;
  const project = pc.project as any;
  const brand = project?.brand as any;
  const products = (pc as any).project_creator_products || [];

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://allsale-affiliate-tracker.vercel.app';

  // Get sample link if available
  let sampleLink: string | undefined;
  if (project && !project.require_shipping_address) {
    const { data: links } = await supabase
      .from('sample_invitation_links')
      .select('url, label')
      .eq('project_id', project.id)
      .eq('is_active', true)
      .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
      .limit(1);
    if (links?.length) sampleLink = links[0].url;
  }

  // Get content guide URL from first assigned product
  const contentGuideUrl = products[0]?.product?.content_guide_url || undefined;

  return {
    creatorName: creator?.name || creator?.tiktok_handle || 'Creator',
    projectName: project?.name || '',
    brandName: brand?.name || '',
    contractLink: `${baseUrl}/c/${pc.unique_slug}`,
    contractAmount: pc.contract_amount || 0,
    commissionRate: (pc as any).commission_rate || 0,
    sampleLink,
    contentGuideUrl,
    submissionDeadline: project?.submission_deadline,
  };
}

/** Compose a reply draft based on classification */
export async function composeDraft(
  classification: EmailClassification,
  projectCreatorId: string
): Promise<{ subject: string; bodyHtml: string } | null> {
  const ctx = await getProjectCreatorContext(projectCreatorId);
  if (!ctx) return null;

  switch (classification) {
    case 'price_negotiation':
      return {
        subject: `Re: Rate Information for ${ctx.projectName}`,
        bodyHtml: `<p>Hi ${ctx.creatorName},</p>
<p>Thank you for your interest! Here are the details for this campaign:</p>
<ul>
<li><strong>Contract Amount:</strong> $${ctx.contractAmount}</li>
<li><strong>Commission Rate:</strong> ${ctx.commissionRate}%</li>
</ul>
<p>You can review and sign your contract here: <a href="${ctx.contractLink}">Sign Contract</a></p>
<p>Let me know if you have any questions!</p>`,
      };

    case 'interest':
      return {
        subject: `Re: Next Steps for ${ctx.projectName}`,
        bodyHtml: `<p>Hi ${ctx.creatorName},</p>
<p>Great to hear you're interested in the <strong>${ctx.projectName}</strong> campaign by ${ctx.brandName}!</p>
<p>Here's your next step — please review and sign your contract: <a href="${ctx.contractLink}">Sign Contract</a></p>
${ctx.sampleLink ? `<p>You can also request your sample here: <a href="${ctx.sampleLink}">Get Sample</a></p>` : ''}
<p>Looking forward to working with you!</p>`,
      };

    case 'sample_request':
      if (ctx.sampleLink) {
        return {
          subject: `Re: Sample Request for ${ctx.projectName}`,
          bodyHtml: `<p>Hi ${ctx.creatorName},</p>
<p>You can request your sample through this link: <a href="${ctx.sampleLink}">Get Sample</a></p>
<p>Let us know once you've received it!</p>`,
        };
      }
      return {
        subject: `Re: Sample Request for ${ctx.projectName}`,
        bodyHtml: `<p>Hi ${ctx.creatorName},</p>
<p>Thank you for reaching out about samples. We'll get back to you shortly with sample details for <strong>${ctx.projectName}</strong>.</p>`,
      };

    case 'content_brief':
      return {
        subject: `Re: Content Guidelines for ${ctx.projectName}`,
        bodyHtml: `<p>Hi ${ctx.creatorName},</p>
${ctx.contentGuideUrl
  ? `<p>Here's the content guide for your campaign: <a href="${ctx.contentGuideUrl}">Content Guide</a></p>`
  : `<p>We'll share the content guidelines for <strong>${ctx.projectName}</strong> shortly.</p>`
}
${ctx.submissionDeadline ? `<p>Submission deadline: <strong>${new Date(ctx.submissionDeadline).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</strong></p>` : ''}
<p>Let us know if you have any questions!</p>`,
      };

    case 'contract_modification':
    case 'shipping_info':
      // These are escalation cases — no draft, handled by Slack
      return null;

    default:
      return null;
  }
}
