import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServer } from '@/lib/supabase-server';
import { sendEmailAndRecord } from '@/lib/email-service';

function getServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) console.error('WARNING: SUPABASE_SERVICE_ROLE_KEY not set, falling back to anon key');
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/** POST /api/emails/send — Send an email via Gmail */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      emailAccountId,
      to,
      cc,
      subject,
      bodyHtml,
      projectCreatorId,
      threadId,
      inReplyTo,
      updateContactInfo,
    } = await req.json();

    if (!emailAccountId || !to || !subject || !bodyHtml) {
      return NextResponse.json({ error: 'emailAccountId, to, subject, bodyHtml required' }, { status: 400 });
    }

    // Gmail threads by threadId alone; In-Reply-To is a cooperating RFC header,
    // not a precondition. Pass both independently.
    const result = await sendEmailAndRecord({
      emailAccountId,
      to,
      cc: cc || undefined,
      subject,
      bodyHtml,
      projectCreatorId,
      threadId: threadId || undefined,
      inReplyTo: inReplyTo || undefined,
    });

    // Post-send project_creator updates.
    //
    // Policy:
    //   - contract_sent / contract_sent_at: always set once on the first send
    //     (gated by contract_sent=false). Tracks that a contract has been sent
    //     at all.
    //   - contact_point / communication_link: caller controls via updateContactInfo.
    //       true  → always overwrite (operator explicitly asked to refresh).
    //       false → never touch (operator explicitly opted out).
    //       undefined (legacy callers e.g. cron) → fall back to "first-send only"
    //         behavior so cron doesn't silently clobber curated values.
    //
    // NOTE: project_creators has a BEFORE UPDATE trigger that reverts most
    // fields for JWT role != 'authenticated' | 'service_role'. If
    // SUPABASE_SERVICE_ROLE_KEY is missing from env, this writer falls back
    // to anon and writes get silently reverted. The one-time startup log
    // below makes that misconfiguration visible in Vercel logs.
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[emails/send] SUPABASE_SERVICE_ROLE_KEY missing — project_creator writes will be reverted by RLS trigger');
    }
    if (projectCreatorId) {
      try {
        const db = getServiceClient();
        const { data: senderAccount } = await db
          .from('email_accounts')
          .select('email')
          .eq('id', emailAccountId)
          .single();

        const senderEmail: string | undefined = senderAccount?.email;
        // Keep the full subject including the thread-ref marker [#XXXXXXXX];
        // operators rely on it to trace which thread a contact_point belongs to.
        const fullSubject = (subject as string).trim();
        const contactPoint = senderEmail
          ? (fullSubject ? `${senderEmail} / ${fullSubject}` : senderEmail)
          : null;
        const gmailLink = senderEmail
          ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(senderEmail)}#inbox/${result.threadId}`
          : `https://mail.google.com/mail/u/0/#inbox/${result.threadId}`;

        // 1. First-send gate: set contract_sent flags + (legacy behavior) contact fields
        //    when contract_sent is still false.
        const firstSendUpdates: Record<string, unknown> = {
          contract_sent: true,
          contract_sent_at: new Date().toISOString(),
        };
        if (updateContactInfo === undefined) {
          // legacy behavior preserved for callers that don't pass the flag
          firstSendUpdates.communication_link = gmailLink;
          if (contactPoint) firstSendUpdates.contact_point = contactPoint;
        }
        const { error: firstErr } = await db
          .from('project_creators')
          .update(firstSendUpdates)
          .eq('id', projectCreatorId)
          .eq('contract_sent', false);
        if (firstErr) console.error('project_creator first-send update failed:', firstErr);

        // 2. Explicit contact refresh: unconditional overwrite when caller opted in.
        if (updateContactInfo === true) {
          const contactUpdates: Record<string, unknown> = {
            communication_link: gmailLink,
          };
          if (contactPoint) contactUpdates.contact_point = contactPoint;
          const { data: refreshed, error: refreshErr } = await db
            .from('project_creators')
            .update(contactUpdates)
            .eq('id', projectCreatorId)
            .select('id, contact_point, communication_link');
          if (refreshErr) {
            console.error('project_creator contact refresh failed:', refreshErr);
          } else if (!refreshed?.length) {
            console.error('project_creator contact refresh matched 0 rows for', projectCreatorId);
          } else {
            console.log('project_creator contact refresh applied:', refreshed[0]);
          }
        }
      } catch (e) {
        console.error('project_creator update error:', e);
      }
    }

    return NextResponse.json({ ...result, contract_updated: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
