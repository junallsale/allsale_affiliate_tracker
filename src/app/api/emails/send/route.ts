import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase-server';
import { sendEmailAndRecord } from '@/lib/email-service';

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

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
