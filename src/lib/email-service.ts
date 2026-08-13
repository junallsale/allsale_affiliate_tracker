/**
 * Email orchestration — compose drafts, send emails, record in DB
 */
import { createClient } from '@supabase/supabase-js';
import { sendGmailEmail } from './gmail';
import { renderTemplate } from './email-templates';
import { buildProductBriefItems, renderContentGuideSectionLi, type BriefItem } from './product-briefs';

/**
 * renderComposedEmail 이 읽는 필드들의 select 조각.
 *
 * cron 처럼 여러 건을 한 번에 처리하는 곳은 이 조각을 목록 조회에 끼워 넣어
 * 건당 재조회를 없앤다. 조각이 갈라지면 렌더 결과가 갈라지므로 단일 소스로 둔다.
 * project 는 호출부가 필터(!inner)나 추가 필드를 붙이는 일이 많아 따로 뺐다.
 */
export const COMPOSE_PROJECT_FIELDS =
  'id, name, require_shipping_address, submission_deadline, welcome_email_subject, welcome_email_body, brand:brands(name)';

export const COMPOSE_PC_FIELDS = `
  id, unique_slug, contract_amount, commission_rate, assigned_video_count, advance_payment,
  creator:creators(name, email, tiktok_handle),
  project_creator_products:project_creator_products(product:products(id, name, content_guide_url, sample_invitation_url, sample_invitation_label, is_bundle))
`;

/** 단건 조회용 — pc 필드 + project 를 합친 완성형. */
export const COMPOSE_PC_SELECT = `${COMPOSE_PC_FIELDS}, project:projects(${COMPOSE_PROJECT_FIELDS})`;

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

export interface ThreadInfo {
  gmailThreadId: string | null;
  inReplyTo: string | null;
  originalSubject: string | null;
}

/** deriveThreadInfo 가 필요로 하는 email_messages 행의 최소 모양. */
export interface ThreadMessageRow {
  gmail_thread_id: string | null;
  message_id_header?: string | null;
  subject?: string | null;
  created_at?: string | null;
}

/**
 * 한 project_creator 의 email_messages 행들에서 답장 스레드 정보를 뽑는다(DB 조회 없음).
 *
 * 최신 스레드 id + 가장 최근 message_id_header(In-Reply-To) + 그 스레드의 첫 제목.
 * Gmail 은 보내는 메일의 Subject 가 스레드 Subject 와 같아야(Re:/Fwd: 무시) threadId 를
 * 받아주기 때문에 첫 제목이 필요하다.
 */
export function deriveThreadInfo(rows: ThreadMessageRow[]): ThreadInfo {
  const withThread = rows.filter((r) => !!r.gmail_thread_id);
  if (!withThread.length) return { gmailThreadId: null, inReplyTo: null, originalSubject: null };

  const at = (r: ThreadMessageRow) => (r.created_at ? Date.parse(r.created_at) : 0);
  const latest = withThread.reduce((a, b) => (at(b) > at(a) ? b : a));
  const threadId = latest.gmail_thread_id as string;

  const sameThread = withThread.filter((r) => r.gmail_thread_id === threadId);
  const first = sameThread.reduce((a, b) => (at(b) < at(a) ? b : a));

  return {
    gmailThreadId: threadId,
    inReplyTo: latest.message_id_header || null,
    originalSubject: first.subject || null,
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

export interface RenderComposedParams {
  /** COMPOSE_PC_SELECT 로 읽은 project_creator 행. */
  pc: any;
  templateSlug: string;
  /** 이 슬러그의 템플릿(제목·본문). 프로젝트 override 는 이 함수가 판단한다. */
  template: { subject: string; body_html: string } | null;
  /** 이미 펼쳐둔 product brief 목록. */
  briefItems: BriefItem[];
  extraVariables?: Record<string, string>;
}

/**
 * 읽어둔 데이터만으로 메일 제목·본문을 만든다(DB 조회 없음).
 *
 * composeEmail 은 이 함수의 조회 래퍼다. 여러 건을 한꺼번에 처리하는 cron 은
 * 목록을 한 번에 읽고 이 함수를 반복 호출한다.
 */
export function renderComposedEmail(params: RenderComposedParams): ComposeResult {
  const { pc } = params;
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
    if (!params.template) throw new Error(`Template '${params.templateSlug}' not found`);
    templateSubject = params.template.subject;
    templateBody = params.template.body_html;
  }

  // Build contract link + unique thread identifier
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://allsale-affiliate-tracker.vercel.app';
  const contractLink = `${baseUrl}/c/${pc.unique_slug}`;
  const threadRef = pc.id.slice(0, 8).toUpperCase(); // unique per project_creator

  // Product info
  const products = (pc as any).project_creator_products || [];
  const allProductNames = products.map((p: any) => p.product?.name).filter(Boolean);
  const productName = allProductNames.join(', ') || '';
  const firstProduct = products[0]?.product;
  const contentGuideUrl = firstProduct?.content_guide_url || '';

  // Sample links from assigned products (not project-level)
  const { sampleLinkSection, sampleLinksSection } = project?.require_shipping_address === false
    ? getProductSampleLinksHtml(products)
    : { sampleLinkSection: '', sampleLinksSection: '' };

  // Content guide section — expands bundle products into component briefs
  const contentGuideSection = renderContentGuideSectionLi(params.briefItems);

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

/** Compose an email draft without sending — 단건용 조회 래퍼. */
export async function composeEmail(params: ComposeParams): Promise<ComposeResult> {
  const supabase = getServiceClient();

  const { data: pc } = await supabase
    .from('project_creators')
    .select(COMPOSE_PC_SELECT)
    .eq('id', params.projectCreatorId)
    .single();

  if (!pc) throw new Error('Project creator not found');

  const { data: template } = await supabase
    .from('email_templates')
    .select('subject, body_html')
    .eq('slug', params.templateSlug)
    .single();

  const briefItems = await buildProductBriefItems((pc as any).project_creator_products, supabase);

  return renderComposedEmail({
    pc,
    templateSlug: params.templateSlug,
    template: template as { subject: string; body_html: string } | null,
    briefItems,
    extraVariables: params.extraVariables,
  });
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
