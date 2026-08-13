import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServer } from '@/lib/supabase-server';
import { listNewEmails, getEmailById } from '@/lib/gmail';
import { classifyEmail } from '@/lib/email-classifier';
import { composeDraft } from '@/lib/draft-composer';
import { escalateToSlack } from '@/lib/slack';
import { isDemoBrandId } from '@/lib/demo';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

async function verifyCron(req: NextRequest): Promise<boolean> {
  // Check CRON_SECRET (Vercel cron or manual URL call)
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth === `Bearer ${secret}`) return true;
    const param = req.nextUrl.searchParams.get('secret');
    if (param === secret) return true;
  } else {
    return true; // No secret configured = allow (dev mode)
  }

  // Also allow if user is authenticated (called from admin UI)
  try {
    const supabase = await createSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) return true;
  } catch {}

  return false;
}

/** Extract email address from "Name <email@example.com>" format */
function extractEmail(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).toLowerCase().trim();
}

/**
 * 제목의 [#XXXXXXXX] 마커로 project_creator 를 찾는다.
 *
 * ★ 2026-08-12: 예전 코드는 `.ilike('id', '<prefix>%')` 였는데, id 는 uuid 컬럼이라
 *   Postgres 가 `operator does not exist: uuid ~~* unknown` (42883) 로 거절한다.
 *   supabase-js 는 이걸 error 로 돌려주고 호출부가 error 를 안 봐서 **항상 미매칭**이었다.
 *   즉 두 전략 중 하나는 처음부터 죽어 있었다.
 *
 *   uuid 는 바이트 순서로 비교되므로 앞 8자리가 같은 구간은
 *   `<prefix>-0000-...` ~ `<prefix>-ffff-...` 범위와 정확히 같다. 캐스팅도 DDL 도 필요 없다.
 */
function threadRefRange(prefix: string): { from: string; to: string } {
  const p = prefix.toLowerCase();
  return {
    from: `${p}-0000-0000-0000-000000000000`,
    to: `${p}-ffff-ffff-ffff-ffffffffffff`,
  };
}

export const maxDuration = 120;

/** GET /api/cron/poll-emails — Poll inbound emails, classify, create drafts */
export async function GET(req: NextRequest) {
  if (!(await verifyCron(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getServiceClient();

  // Get active email accounts
  const { data: accounts } = await supabase
    .from('email_accounts')
    .select('id, email, gmail_refresh_token')
    .eq('is_active', true);

  if (!accounts?.length) {
    return NextResponse.json({ message: 'No active email accounts' });
  }

  const since = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
  let totalProcessed = 0;
  let totalDrafts = 0;
  let totalEscalated = 0;
  let totalEscalationFailed = 0;

  for (const account of accounts) {
    try {
      const messages = await listNewEmails(account.gmail_refresh_token, since);

      for (const msg of messages) {
        // Skip if already processed
        const { data: existing } = await supabase
          .from('email_messages')
          .select('id')
          .eq('gmail_message_id', msg.id)
          .limit(1);

        if (existing?.length) continue;

        // Fetch full email
        const email = await getEmailById(account.gmail_refresh_token, msg.id);
        const fromEmail = extractEmail(email.from);

        // Skip if it's our own sent email
        if (fromEmail === account.email.toLowerCase()) continue;

        // Match to a project_creator.
        //
        // ONLY two strategies are used — both verify the email is a reply to
        // a conversation we initiated through our system:
        //
        //   1. Gmail thread ID → outbound email_messages row
        //   2. Subject thread-ref marker [#XXXXXXXX] → project_creators.id prefix
        //
        // Email-address-only matching (strategies 3-5 in the old code) was removed
        // because it pulled in unrelated emails sent outside our system and
        // mis-routed replies from old projects to the newest project_creator.
        // Emails that don't match either strategy are recorded with
        // project_creator_id=null and surfaced in the "unmatched" tab of
        // /admin/email-queue for manual triage.
        let pcMatch: any = null;
        const pcSelect = 'id, creator:creators(email, tiktok_handle), project:projects(id, name, require_shipping_address, brand_id, brand:brands(name))';

        // 1. Match by Gmail thread ID — if we sent an outbound email in this thread, reuse its project_creator_id
        if (email.threadId) {
          const { data: threadMatch } = await supabase
            .from('email_messages')
            .select('project_creator_id')
            .eq('gmail_thread_id', email.threadId)
            .eq('direction', 'outbound')
            .not('project_creator_id', 'is', null)
            .order('created_at', { ascending: false })
            .limit(1);

          if (threadMatch?.length && threadMatch[0].project_creator_id) {
            const { data: pcs } = await supabase
              .from('project_creators')
              .select(pcSelect)
              .eq('id', threadMatch[0].project_creator_id)
              .limit(1);
            if (pcs?.length) pcMatch = pcs[0];
          }
        }

        // 2. Match by thread ref [#XXXXXXXX] in subject — exact project_creator match
        if (!pcMatch && email.subject) {
          const refMatch = email.subject.match(/\[#([A-F0-9]{8})\]/i);
          if (refMatch) {
            const range = threadRefRange(refMatch[1]);
            const { data: pcs, error } = await supabase
              .from('project_creators')
              .select(pcSelect)
              .gte('id', range.from)
              .lte('id', range.to)
              .limit(1);
            if (error) console.error('[poll] thread-ref lookup failed:', error.message);
            if (pcs?.length) pcMatch = pcs[0];
          }
        }

        if (!pcMatch) {
          console.log(`[poll] unmatched inbound from ${fromEmail} — subject: ${email.subject?.slice(0, 80)}`);
        }

        // Classify the email
        const classification = await classifyEmail(email.subject, email.bodyText);

        // Store in email_messages
        const { data: savedMsg } = await supabase
          .from('email_messages')
          .insert({
            email_account_id: account.id,
            project_creator_id: (pcMatch as any)?.id || null,
            gmail_message_id: email.id,
            gmail_thread_id: email.threadId,
            direction: 'inbound',
            from_email: fromEmail,
            to_email: account.email,
            subject: email.subject,
            body_text: email.bodyText,
            body_html: email.bodyHtml,
            classification,
            message_id_header: email.messageIdHeader || null,
            cc_emails: email.cc || null,
            received_at: email.date ? new Date(email.date).toISOString() : new Date().toISOString(),
          })
          .select('id')
          .single();

        totalProcessed++;

        if (!pcMatch || !savedMsg) continue;

        const project = (pcMatch as any).project;
        const creator = (pcMatch as any).creator;
        const pcId = (pcMatch as any).id;

        // Skip demo data — never auto-draft or escalate for the demo brand
        if (isDemoBrandId(project?.brand_id)) continue;

        // Handle escalation cases.
        //
        // ★ 슬랙이 실제로 받은 뒤에만 escalated 마커를 남긴다.
        //   반대 순서면 발송이 실패해도 "보냈다"로 기록되어 아무도 모르게 사라진다.
        //   실패한 건은 escalated=false 로 남아 /admin/email-queue 에서 눈에 띈다.
        const escalate = async (reason: string, escalationReason: string) => {
          const result = await escalateToSlack({
            reason,
            creatorName: creator?.tiktok_handle || fromEmail,
            creatorEmail: fromEmail,
            projectName: project?.name,
            emailSnippet: email.bodyText?.slice(0, 200),
            adminLink: `${process.env.NEXT_PUBLIC_APP_URL || ''}/admin/email-queue`,
          });

          if (!result.ok) {
            console.error(`[poll] Slack escalation failed (${escalationReason}) for message ${savedMsg.id}:`, result.error);
            totalEscalationFailed++;
            return;
          }

          await supabase
            .from('email_messages')
            .update({ escalated: true, escalation_reason: escalationReason })
            .eq('id', savedMsg.id);
          totalEscalated++;
        };

        if (classification === 'contract_modification') {
          await escalate('Contract Modification Request', 'contract_modification');
          continue;
        }

        if (classification === 'shipping_info' && project?.require_shipping_address) {
          await escalate('Shipping Address — Direct Delivery Needed', 'shipping_direct_delivery');
          continue;
        }

        // Compose reply draft for Email Queue
        const draft = await composeDraft(classification, pcId, email.subject);
        if (draft) {
          await supabase.from('email_drafts').insert({
            email_message_id: savedMsg.id,
            project_creator_id: pcId,
            draft_subject: draft.subject,
            draft_body_html: draft.bodyHtml,
            classification,
            status: 'pending',
            gmail_thread_id: email.threadId || null,
            in_reply_to: email.messageIdHeader || null,
          });
          totalDrafts++;
        }
      }
    } catch (err) {
      console.error(`Error polling account ${account.email}:`, err);
    }
  }

  return NextResponse.json({
    processed: totalProcessed,
    drafts: totalDrafts,
    escalated: totalEscalated,
    escalation_failed: totalEscalationFailed,
  });
}
