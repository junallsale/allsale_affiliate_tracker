import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { composeEmail } from '@/lib/email-service';
import { escalateToSlack } from '@/lib/slack';

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

/** GET /api/cron/daily-remind — Create reminder drafts + escalate 7-day no-reply */
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
      id, unique_slug, signed_at, created_at, contract_amount,
      creator:creators(name, email, tiktok_handle),
      project:projects!inner(id, name, status, submission_deadline, brand:brands(name)),
      videos(id)
    `)
    .eq('project.status', 'active')
    .or('is_deleted.is.null,is_deleted.eq.false');

  if (!pcs?.length) {
    return NextResponse.json({ message: 'No active project creators' });
  }

  let remindSign = 0;
  let remindPost = 0;
  let escalated = 0;

  for (const pc of pcs) {
    const creator = pc.creator as any;
    const project = (pc as any).project as any;
    const brand = project?.brand as any;
    const videos = (pc.videos || []) as any[];
    const createdAt = new Date(pc.created_at);

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

    // Case 1: Contract not signed + created > 1 day ago
    if (!pc.signed_at && createdAt < oneDayAgo) {
      try {
        const draft = await composeEmail({
          projectCreatorId: pc.id,
          templateSlug: 'remind_sign_contract',
        });

        await supabase.from('email_drafts').insert({
          project_creator_id: pc.id,
          draft_subject: draft.subject,
          draft_body_html: draft.bodyHtml,
          classification: 'reminder',
          status: 'pending',
        });
        remindSign++;
      } catch {}
      continue;
    }

    // Case 2: Signed but no videos + created > 3 days ago
    if (pc.signed_at && videos.length === 0 && createdAt < threeDaysAgo) {
      try {
        const draft = await composeEmail({
          projectCreatorId: pc.id,
          templateSlug: 'remind_post_video',
        });

        await supabase.from('email_drafts').insert({
          project_creator_id: pc.id,
          draft_subject: draft.subject,
          draft_body_html: draft.bodyHtml,
          classification: 'reminder',
          status: 'pending',
        });
        remindPost++;
      } catch {}
    }

    // Case 3: 7+ days no reply — escalate
    const { data: lastInbound } = await supabase
      .from('email_messages')
      .select('received_at')
      .eq('project_creator_id', pc.id)
      .eq('direction', 'inbound')
      .order('received_at', { ascending: false })
      .limit(1);

    const lastReply = lastInbound?.[0]?.received_at
      ? new Date(lastInbound[0].received_at)
      : null;

    // Check if there's been any outbound email sent
    const { data: lastOutbound } = await supabase
      .from('email_messages')
      .select('sent_at')
      .eq('project_creator_id', pc.id)
      .eq('direction', 'outbound')
      .order('sent_at', { ascending: false })
      .limit(1);

    const hasOutbound = lastOutbound && lastOutbound.length > 0;

    // Escalate if: we've sent email, no reply for 7 days (or no reply ever and created > 7 days)
    if (hasOutbound) {
      const noReplyFor7Days = !lastReply && createdAt < sevenDaysAgo;
      const lastReplyOlderThan7Days = lastReply && lastReply < sevenDaysAgo;

      if (noReplyFor7Days || lastReplyOlderThan7Days) {
        // Check if already escalated recently
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

          // Record escalation
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
    remind_post: remindPost,
    escalated,
  });
}
