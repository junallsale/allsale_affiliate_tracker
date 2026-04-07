import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase-server';
import { composeEmail } from '@/lib/email-service';

/** POST /api/emails/compose — Generate email draft without sending */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { projectCreatorId, templateSlug } = await req.json();
    if (!projectCreatorId || !templateSlug) {
      return NextResponse.json({ error: 'projectCreatorId and templateSlug required' }, { status: 400 });
    }

    const draft = await composeEmail({ projectCreatorId, templateSlug });
    return NextResponse.json(draft);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
