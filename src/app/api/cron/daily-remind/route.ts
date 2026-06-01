import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { composeEmail, getThreadInfo, toReplySubject } from '@/lib/email-service';
import { escalateToSlack } from '@/lib/slack';
import { isDemoBrandId } from '@/lib/demo';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

function verifyCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get('authorization');
  if (auth === `Bearer ${secret}`) return true;
  const param = req.nextUrl.searchParams.get('secret');
  return param === secret;
}

export const maxDuration = 120;

/** GET /api/cron/daily-remind — Create reminder drafts + escalate */
export async function GET(req: NextRequest) {
  if (!verifyCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getServiceClient();
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Get all active project creators
  const { data: pcs } = await supabase
    .from('project_creators')
    .select(`
      id, unique_slug, signed_at, created_at, contract_amount, advance_payment,
      creator:creators(name, email, tiktok_handle),
      project:projects!inner(id, name, status, submission_deadline, require_shipping_address, brand_id, brand:brands(name)),
      videos(id)
    `)
    .eq('project.status', 'active')
    .or('is_deleted.is.null,is_deleted.eq.false');

  if (!pcs?.length) {
    return NextResponse.json({ message: 'No active project creators' });
  }

  let remindSign = 0;
  let remindPostSign = 0;
  let remindPost = 0;
  let escalated = 0;

  for (const pc of pcs) {
    const creator = pc.creator as any;
    const project = (pc as any).project as any;
    const brand = project?.brand as any;
    const videos = (pc.videos || []) as any[];
    const createdAt = new Date(pc.created_at);
    const signedAt = pc.signed_at ? new Date(pc.signed_at) : null;

    // Skip demo data — never generate reminders/escalations for the demo brand
    if (isDemoBrandId(project?.brand_id)) continue;

    // Skip if created less than 1 day ago
    if (createdAt > oneDayAgo) continue;

    // Check for existing drafts today to avoid duplicates
    const today = now.toISOString().split('T')[0];
    const { data: existingDrafts } = await supabase
      .from('email_drafts')
      .select('id')
      .eq('project_creator_id', pc.id)
      .gte('created_at', today)
      .limit(1);

    if (existingDrafts?.length) continue;

    // Get thread info for this project_creator (to reply in existing thread).
    // Gmail requires the new message's Subject to match the thread's Subject
    // (ignoring Re:/Fwd: prefixes) — otherwise it rejects threadId on send.
    // When replying to an existing thread, override the template subject with
    // "Re: <original subject>" so Gmail attaches the reminder to the thread.
    const threadInfo = await getThreadInfo(pc.id);
    const replySubject = (subject: string) =>
      threadInfo.originalSubject ? toReplySubject(threadInfo.originalSubject) : subject;

    // ── Case 1: Contract not signed ──
    if (!pc.signed_at) {
      try {
        const draft = await composeEmail({
          projectCreatorId: pc.id,
          templateSlug: 'remind_sign_contract',
        });
        await supabase.from('email_drafts').insert({
          project_creator_id: pc.id,
          draft_subject: replySubject(draft.subject),
          draft_body_html: draft.bodyHtml,
          classification: 'reminder',
          status: 'pending',
          gmail_thread_id: threadInfo.gmailThreadId,
          in_reply_to: threadInfo.inReplyTo,
        });
        remindSign++;
      } catch {}
      continue;
    }

    // ── Case 2: Signed + shipping ON → escalate for direct shipping ──
    if (signedAt && project?.require_shipping_address === true) {
      const { data: recentEsc } = await supabase
        .from('email_messages')
        .select('id')
        .eq('project_creator_id', pc.id)
        .eq('escalation_reason', 'signed_shipping_on')
        .limit(1);

      if (!recentEsc?.length) {
        await escalateToSlack({
          reason: 'Signed + Shipping ON — Direct shipping needed',
          creatorName: creator?.tiktok_handle || creator?.name || 'Unknown',
          creatorEmail: creator?.email,
          projectName: `${brand?.name} / ${project?.name}`,
          adminLink: `${process.env.NEXT_PUBLIC_APP_URL || ''}/admin/email-queue`,
        });
        await supabase.from('email_messages').insert({
          project_creator_id: pc.id,
          direction: 'inbound',
          from_email: creator?.email || 'system',
          to_email: 'system',
          subject: '[System] Signed + Shipping ON escalation',
          escalated: true,
          escalation_reason: 'signed_shipping_on',
          received_at: now.toISOString(),
        });
        escalated++;
      }
      continue;
    }

    // ── Case 3: Signed + shipping OFF + recently signed (within 3 days) → post-sign follow-up ──
    if (signedAt && signedAt > threeDaysAgo && videos.length === 0) {
      try {
        const draft = await composeEmail({
          projectCreatorId: pc.id,
          templateSlug: 'post_sign_shipping_off',
        });
        await supabase.from('email_drafts').insert({
          project_creator_id: pc.id,
          draft_subject: replySubject(draft.subject),
          draft_body_html: draft.bodyHtml,
          classification: 'reminder',
          status: 'pending',
          gmail_thread_id: threadInfo.gmailThreadId,
          in_reply_to: threadInfo.inReplyTo,
        });
        remindPostSign++;
      } catch {}
      continue;
    }

    // ── Case 4: Signed + no videos + signed > 3 days ago → posting reminder ──
    if (signedAt && signedAt < threeDaysAgo && videos.length === 0) {
      try {
        const draft = await composeEmail({
          projectCreatorId: pc.id,
          templateSlug: 'remind_post_video_v2',
        });
        await supabase.from('email_drafts').insert({
          project_creator_id: pc.id,
          draft_subject: replySubject(draft.subject),
          draft_body_html: draft.bodyHtml,
          classification: 'reminder',
          status: 'pending',
          gmail_thread_id: threadInfo.gmailThreadId,
          in_reply_to: threadInfo.inReplyTo,
        });
        remindPost++;
      } catch {}
    }

    // ── Case 5: 7+ days no reply → escalate ──
    const { data: lastInbound } = await supabase
      .from('email_messages')
      .select('received_at')
      .eq('project_creator_id', pc.id)
      .eq('direction', 'inbound')
      .order('received_at', { ascending: false })
      .limit(1);

    const lastReply = lastInbound?.[0]?.received_at ? new Date(lastInbound[0].received_at) : null;

    const { data: lastOutbound } = await supabase
      .from('email_messages')
      .select('sent_at')
      .eq('project_creator_id', pc.id)
      .eq('direction', 'outbound')
      .order('sent_at', { ascending: false })
      .limit(1);

    const hasOutbound = lastOutbound && lastOutbound.length > 0;

    if (hasOutbound) {
      const noReplyFor7Days = !lastReply && createdAt < sevenDaysAgo;
      const lastReplyOlderThan7Days = lastReply && lastReply < sevenDaysAgo;

      if (noReplyFor7Days || lastReplyOlderThan7Days) {
        const { data: recentEscalation } = await supabase
          .from('email_messages')
          .select('id')
          .eq('project_creator_id', pc.id)
          .eq('escalated', true)
          .eq('escalation_reason', '7_days_no_reply')
          .gte('created_at', sevenDaysAgo.toISOString())
          .limit(1);

        if (!recentEscalation?.length) {
          await escalateToSlack({
            reason: '7+ Days No Reply',
            creatorName: creator?.tiktok_handle || creator?.name || 'Unknown',
            creatorEmail: creator?.email,
            projectName: `${brand?.name} / ${project?.name}`,
            adminLink: `${process.env.NEXT_PUBLIC_APP_URL || ''}/admin/email-queue`,
          });
          await supabase.from('email_messages').insert({
            project_creator_id: pc.id,
            direction: 'inbound',
            from_email: creator?.email || 'unknown',
            to_email: 'system',
            subject: '[System] 7-day no reply escalation',
            classification: 'escalation',
            escalated: true,
            escalation_reason: '7_days_no_reply',
            received_at: now.toISOString(),
          });
          escalated++;
        }
      }
    }
  }

  return NextResponse.json({
    remind_sign: remindSign,
    remind_post_sign: remindPostSign,
    remind_post: remindPost,
    escalated,
  });
}
