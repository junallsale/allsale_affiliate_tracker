/**
 * Email orchestration — compose drafts, send emails, record in DB
 */
import { createClient } from '@supabase/supabase-js';
import { sendGmailEmail } from './gmail';
import { renderTemplate } from './email-templates';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

interface ComposeParams {
  projectCreatorId: string;
  templateSlug: string;
  extraVariables?: Record<string, string>;
}

interface ComposeResult {
  subject: string;
  bodyHtml: string;
  toEmail: string;
  creatorName: string;
  variables: Record<string, string>;
}

/** Compose an email draft without sending */
export async function composeEmail(params: ComposeParams): Promise<ComposeResult> {
  const supabase = getServiceClient();

  // Fetch project_creator with relations
  const { data: pc } = await supabase
    .from('project_creators')
    .select(`
      id, unique_slug, contract_amount, commission_rate, assigned_video_count,
      creator:creators(name, email, tiktok_handle),
      project:projects(id, name, require_shipping_address, submission_deadline, brand:brands(name)),
      project_creator_products:project_creator_products(product:products(name, content_guide_url))
    `)
    .eq('id', params.projectCreatorId)
    .single();

  if (!pc) throw new Error('Project creator not found');

  const creator = pc.creator as any;
  const project = pc.project as any;
  const brand = project?.brand as any;

  // Fetch template
  const { data: template } = await supabase
    .from('email_templates')
    .select('subject, body_html')
    .eq('slug', params.templateSlug)
    .single();

  if (!template) throw new Error(`Template '${params.templateSlug}' not found`);

  // Build contract link
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://allsale-affiliate-tracker.vercel.app';
  const contractLink = `${baseUrl}/c/${pc.unique_slug}`;

  // Product info
  const products = (pc as any).project_creator_products || [];
  const firstProduct = products[0]?.product;
  const productName = firstProduct?.name || '';
  const contentGuideUrl = firstProduct?.content_guide_url || '';

  // Check for sample invitation links
  let sampleLinkSection = '';
  if (project?.require_shipping_address === false) {
    const { data: sampleLinks } = await supabase
      .from('sample_invitation_links')
      .select('url, label')
      .eq('project_id', project.id)
      .eq('is_active', true)
      .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(1);

    if (sampleLinks?.length) {
      const link = sampleLinks[0];
      sampleLinkSection = `<li><strong>Sample invitation:</strong> <a href="${link.url}">${link.label || 'Request Sample'}</a></li>`;
    }
  }

  // Content guide section
  const contentGuideSection = contentGuideUrl
    ? `<li><strong>Product brief:</strong> <a href="${contentGuideUrl}">Content Guide</a></li>`
    : '';

  const variables: Record<string, string> = {
    creator_name: creator?.name || creator?.tiktok_handle || 'Creator',
    project_name: project?.name || '',
    brand_name: brand?.name || '',
    contract_link: contractLink,
    contract_amount: String(pc.contract_amount || 0),
    video_count: String((pc as any).assigned_video_count || 1),
    product_name: productName,
    content_guide_section: contentGuideSection,
    sample_link_section: sampleLinkSection,
    sender_name: '', // Will be filled by sender selection
    deadline_note: project?.submission_deadline
      ? `Your submission deadline is ${new Date(project.submission_deadline).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.`
      : '',
    ...params.extraVariables,
  };

  return {
    subject: renderTemplate(template.subject, variables),
    bodyHtml: renderTemplate(template.body_html, variables),
    toEmail: creator?.email || '',
    creatorName: variables.creator_name,
    variables,
  };
}

interface SendParams {
  emailAccountId: string;
  to: string;
  subject: string;
  bodyHtml: string;
  projectCreatorId?: string;
  threadId?: string;
  inReplyTo?: string;
}

/** Send an email via Gmail and record in email_messages */
export async function sendEmailAndRecord(params: SendParams): Promise<{
  messageId: string;
  threadId: string;
}> {
  const supabase = getServiceClient();

  // Get sender account
  const { data: account } = await supabase
    .from('email_accounts')
    .select('email, gmail_refresh_token')
    .eq('id', params.emailAccountId)
    .single();

  if (!account) throw new Error('Email account not found');

  // Send via Gmail
  const result = await sendGmailEmail({
    refreshToken: account.gmail_refresh_token,
    from: account.email,
    to: params.to,
    subject: params.subject,
    bodyHtml: params.bodyHtml,
    threadId: params.threadId,
    inReplyTo: params.inReplyTo,
  });

  // Record in email_messages
  await supabase.from('email_messages').insert({
    email_account_id: params.emailAccountId,
    project_creator_id: params.projectCreatorId || null,
    gmail_message_id: result.messageId,
    gmail_thread_id: result.threadId,
    direction: 'outbound',
    from_email: account.email,
    to_email: params.to,
    subject: params.subject,
    body_html: params.bodyHtml,
    sent_at: new Date().toISOString(),
  });

  return result;
}
