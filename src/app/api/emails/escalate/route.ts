import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase-server';
import { escalateToSlack } from '@/lib/slack';

/** POST /api/emails/escalate — Manually escalate to Slack */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const ok = await escalateToSlack({
      reason: body.reason || 'Manual escalation',
      creatorName: body.creatorName || 'Unknown',
      creatorEmail: body.creatorEmail,
      projectName: body.projectName,
      emailSnippet: body.emailSnippet,
      adminLink: body.adminLink || `${process.env.NEXT_PUBLIC_APP_URL || ''}/admin/email-queue`,
    });

    return NextResponse.json({ ok });
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
