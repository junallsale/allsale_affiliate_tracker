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

    const { emailAccountId, to, cc, subject, bodyHtml, projectCreatorId, threadId, inReplyTo } = await req.json();

    if (!emailAccountId || !to || !subject || !bodyHtml) {
      return NextResponse.json({ error: 'emailAccountId, to, subject, bodyHtml required' }, { status: 400 });
    }

    const result = await sendEmailAndRecord({
      emailAccountId,
      to,
      cc: cc || undefined,
      subject,
      bodyHtml,
      projectCreatorId,
      threadId: inReplyTo ? threadId : undefined,
      inReplyTo,
    });

    // Auto-check contract_sent on first outbound email for this project_creator
    if (projectCreatorId) {
      try {
        const db = getServiceClient();
        const { error: updateErr } = await db
          .from('project_creators')
          .update({ contract_sent: true, contract_sent_at: new Date().toISOString() })
          .eq('id', projectCreatorId)
          .eq('contract_sent', false);
        if (updateErr) console.error('contract_sent update failed:', updateErr);
      } catch (e) {
        console.error('contract_sent update error:', e);
      }
    }

    return NextResponse.json({ ...result, contract_updated: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
