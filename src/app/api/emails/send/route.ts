import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServer } from '@/lib/supabase-server';
import { sendEmailAndRecord } from '@/lib/email-service';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/** POST /api/emails/send — Send an email via Gmail */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { emailAccountId, to, subject, bodyHtml, projectCreatorId, threadId, inReplyTo } = await req.json();

    if (!emailAccountId || !to || !subject || !bodyHtml) {
      return NextResponse.json({ error: 'emailAccountId, to, subject, bodyHtml required' }, { status: 400 });
    }

    const result = await sendEmailAndRecord({
      emailAccountId,
      to,
      subject,
      bodyHtml,
      projectCreatorId,
      threadId,
      inReplyTo,
    });

    // Auto-check contract_sent if this is the first outbound email with a contract link
    if (projectCreatorId && bodyHtml.includes('/c/')) {
      const db = getServiceClient();
      await db
        .from('project_creators')
        .update({ contract_sent: true, contract_sent_at: new Date().toISOString() })
        .eq('id', projectCreatorId)
        .eq('contract_sent', false);
    }

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
