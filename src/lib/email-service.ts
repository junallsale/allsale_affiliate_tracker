/**
 * Email orchestration — compose drafts, send emails, record in DB
 */
import { createClient } from '@supabase/supabase-js';
import { sendGmailEmail } from './gmail';
import { renderTemplate } from './email-templates';
import { buildProductBriefItems, renderContentGuideSectionLi } from './product-briefs';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/** Normalize a subject for use as a reply: ensure "Re: " prefix, avoid double-prefixing. */
export function toReplySubject(subject: string): string {
  const trimmed = subject.trim();
  return /^re:\s/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

/**
 * Get thread info for a project_creator to enable reply threading.
 *
 * Returns the latest thread's id + the most recent message_id_header
 * (for In-Reply-To) + the thread's canonical subject (the first message in
 * that thread), which is required so Gmail accepts the threadId on send.
 */
export async function getThreadInfo(projectCreatorId: string): Promise<{
  gmailThreadId: string | null;
  inReplyTo: string | null;
  originalSubject: string | null;
}> {
  const supabase = getServiceClient();
  // Latest row with a thread id — provides thread + (possibly) In-Reply-To
  const { data: latest } = await supabase
    .from('email_messages')
    .select('gmail_thread_id, message_id_header')
    .eq('project_creator_id', projectCreatorId)
    .not('gmail_thread_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!latest?.length) return { gmailThreadId: null, inReplyTo: null, originalSubject: null };

  const threadId = latest[0].gmail_thread_id as string;

  // First message in that same thread — provides the canonical subject
  // Gmail's send API requires the new message's Subject to match the thread's Subject
  // (Re:/Fwd: prefixes are normalized out), otherwise it refuses to attach.
  const { data: first } = await supabase
    .from('email_messages')
    .select('subject')
    .eq('project_creator_id', projectCreatorId)
    .eq('gmail_thread_id', threadId)
    .order('created_at', { ascending: true })
    .limit(1);

  return {
    gmailThreadId: threadId,
    inReplyTo: latest[0].message_id_header || null,
    originalSubject: first?.[0]?.subject || null,
  };
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

/** Build sample links HTML from assigned products' sample_invitation_url */
function getProductSampleLinksHtml(products: any[]): { sampleLinkSection: string; sampleLinksSection: string } {
  const links = products
    .map(p => p.product)
    .filter(p => p?.sample_invitation_url)
    .map(p => ({ url: p.sample_invitation_url, label: p.sample_invitation_label || p.name }));

  if (!links.length) return { sampleLinkSection: '', sampleLinksSection: '' };

  if (links.length === 1) {
    const html = ` <a href="${links[0].url}">${links[0].label}</a>`;
    return {
      sampleLinkSection: `<li><strong>Sample invitation:</strong>${html}</li>`,
      sampleLinksSection: html,
    };
  }

  const items = links.map(l => `<a href="${l.url}">${l.label}</a>`).join(', ');
  return {
    sampleLinkSection: `<li><strong>Sample invitation:</strong> ${items}</li>`,
    sampleLinksSection: items,
  };
}

/** Compose an email draft without sending */
export async function composeEmail(params: ComposeParams): Promise<ComposeResult> {
  const supabase = getServiceClient();

  // Fetch project_creator with relations
  const { data: pc } = await supabase
    .from('project_creators')
    .select(`
      id, unique_slug, contract_amount, commission_rate, assigned_video_count, advance_payment,
      creator:creators(name, email, tiktok_handle),
      project:projects(id, name, require_shipping_address, submission_deadline, welcome_email_subject, welcome_email_body, brand:brands(name)),
      project_creator_products:project_creator_products(product:products(id, name, content_guide_url, sample_invitation_url, sample_invitation_label, is_bundle))
    `)
    .eq('id', params.projectCreatorId)
    .single();

  if (!pc) throw new Error('Project creator not found');

  const creator = pc.creator as any;
  const project = pc.project as any;
  const brand = project?.brand as any;

  // Check for project-level template override (only for confirmed_welcome)
  let templateSubject: string;
  let templateBody: string;

  if (params.templateSlug === 'confirmed_welcome' && project?.welcome_email_subject && project?.welcome_email_body) {
    templateSubject = project.welcome_email_subject;
    templateBody = project.welcome_email_body;
  } else {
    const { data: template } = await supabase
      .from('email_templates')
      .select('subject, body_html')
      .eq('slug', params.templateSlug)
      .single();
    if (!template) throw new Error(`Template '${params.templateSlug}' not found`);
    templateSubject = template.subject;
    templateBody = template.body_html;
  }

  // Build contract link + unique thread identifier
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://allsale-affiliate-tracker.vercel.app';
  const contractLink = `${baseUrl}/c/${pc.unique_slug}`;
  const threadRef = pc.id.slice(0, 8).toUpperCase(); // unique per project_creator

  // Product info
  const products = (pc as any).project_creator_products || [];
  const firstProduct = products[0]?.product;
  const productName = firstProduct?.name || '';
  const contentGuideUrl = firstProduct?.content_guide_url || '';

  // Sample links from assigned products (not project-level)
  const { sampleLinkSection, sampleLinksSection } = project?.require_shipping_address === false
    ? getProductSampleLinksHtml(products)
    : { sampleLinkSection: '', sampleLinksSection: '' };

  // Content guide section — expands bundle products into component briefs
  const briefItems = await buildProductBriefItems(products, supabase);
  const contentGuideSection = renderContentGuideSectionLi(briefItems);

  // Advance payment section
  const advancePayment = (pc as any).advance_payment || 0;
  const advancePaymentSection = advancePayment > 0
    ? `<li><strong>Advance payment:</strong> $${advancePayment} will be processed within 1 business day after signing</li>`
    : '';

  // Deadline section
  const deadlineSection = project?.submission_deadline
    ? `<p><strong>Submission deadline:</strong> ${new Date(project.submission_deadline).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>`
    : '';

  const variables: Record<string, string> = {
    creator_name: creator?.name || creator?.tiktok_handle || 'Creator',
    project_name: project?.name || '',
    brand_name: brand?.name || '',
    thread_ref: threadRef,
    contract_link: contractLink,
    contract_amount: String(pc.contract_amount || 0),
    video_count: String((pc as any).assigned_video_count || 1),
    product_name: productName,
    content_guide_section: contentGuideSection,
    content_guide_link: contentGuideUrl,
    sample_link_section: sampleLinkSection,
    sample_links_section: sampleLinksSection,
    advance_payment_section: advancePaymentSection,
    deadline_section: deadlineSection,
    sender_name: '', // Will be filled by sender selection
    deadline_note: project?.submission_deadline
      ? `Your submission deadline is ${new Date(project.submission_deadline).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.`
      : '',
    ...params.extraVariables,
  };

  const renderedSubject = renderTemplate(templateSubject, variables);
  // Ensure thread ref is in subject for unique Gmail threading
  const finalSubject = renderedSubject.includes(`[#${threadRef}]`)
    ? renderedSubject
    : `${renderedSubject} [#${threadRef}]`;

  return {
    subject: finalSubject,
    bodyHtml: renderTemplate(templateBody, variables),
    toEmail: creator?.email || '',
    creatorName: variables.creator_name,
    variables,
  };
}

interface SendParams {
  emailAccountId: string;
  to: string;
  cc?: string;
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
    cc: params.cc,
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
    message_id_header: result.messageIdHeader,
    direction: 'outbound',
    from_email: account.email,
    to_email: params.to,
    cc_emails: params.cc || null,
    subject: params.subject,
    body_html: params.bodyHtml,
    sent_at: new Date().toISOString(),
  });

  return result;
}
