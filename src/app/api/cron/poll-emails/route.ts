import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { listNewEmails, getEmailById } from '@/lib/gmail';
import { classifyEmail } from '@/lib/email-classifier';
import { composeDraft } from '@/lib/draft-composer';
import { escalateToSlack } from '@/lib/slack';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

function verifyCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // No secret configured = allow (dev mode)
  const auth = req.headers.get('authorization');
  if (auth === `Bearer ${secret}`) return true;
  const param = req.nextUrl.searchParams.get('secret');
  return param === secret;
}

/** Extract email address from "Name <email@example.com>" format */
function extractEmail(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).toLowerCase().trim();
}

export const maxDuration = 120;

/** GET /api/cron/poll-emails — Poll inbound emails, classify, create drafts */
export async function GET(req: NextRequest) {
  if (!verifyCron(req)) {
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

        // Match to a project_creator
        const { data: matchedPcs } = await supabase
          .from('project_creators')
          .select('id, creator:creators(email, tiktok_handle), project:projects(id, name, require_shipping_address, brand:brands(name))')
          .or(`creator.email.eq.${fromEmail}`)
          .limit(5);

        // Also try matching by payment_email
        let pcMatch = matchedPcs?.find((pc: any) => {
          const creatorEmail = (pc.creator?.email || '').toLowerCase();
          return creatorEmail === fromEmail;
        });

        if (!pcMatch) {
          const { data: byPayment } = await supabase
            .from('project_creators')
            .select('id, creator:creators(email, tiktok_handle), project:projects(id, name, require_shipping_address, brand:brands(name))')
            .eq('payment_email', fromEmail)
            .limit(1);
          if (byPayment?.length) pcMatch = byPayment[0];
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
            received_at: email.date ? new Date(email.date).toISOString() : new Date().toISOString(),
          })
          .select('id')
          .single();

        totalProcessed++;

        if (!pcMatch || !savedMsg) continue;

        const project = (pcMatch as any).project;
        const creator = (pcMatch as any).creator;
        const pcId = (pcMatch as any).id;

        // Handle escalation cases
        if (classification === 'contract_modification') {
          await escalateToSlack({
            reason: 'Contract Modification Request',
            creatorName: creator?.tiktok_handle || fromEmail,
            creatorEmail: fromEmail,
            projectName: project?.name,
            emailSnippet: email.bodyText?.slice(0, 200),
            adminLink: `${process.env.NEXT_PUBLIC_APP_URL || ''}/admin/email-queue`,
          });
          await supabase.from('email_messages').update({ escalated: true, escalation_reason: 'contract_modification' }).eq('id', savedMsg.id);
          totalEscalated++;
          continue;
        }

        if (classification === 'shipping_info' && project?.require_shipping_address) {
          await escalateToSlack({
            reason: 'Shipping Address — Direct Delivery Needed',
            creatorName: creator?.tiktok_handle || fromEmail,
            creatorEmail: fromEmail,
            projectName: project?.name,
            emailSnippet: email.bodyText?.slice(0, 200),
            adminLink: `${process.env.NEXT_PUBLIC_APP_URL || ''}/admin/email-queue`,
          });
          await supabase.from('email_messages').update({ escalated: true, escalation_reason: 'shipping_direct_delivery' }).eq('id', savedMsg.id);
          totalEscalated++;
          continue;
        }

        // Compose reply draft for Email Queue
        const draft = await composeDraft(classification, pcId);
        if (draft) {
          await supabase.from('email_drafts').insert({
            email_message_id: savedMsg.id,
            project_creator_id: pcId,
            draft_subject: draft.subject,
            draft_body_html: draft.bodyHtml,
            classification,
            status: 'pending',
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
  });
}
