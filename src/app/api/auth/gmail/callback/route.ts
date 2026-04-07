import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { exchangeCodeForTokens } from '@/lib/gmail';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/** GET /api/auth/gmail/callback — Exchange code for tokens, save to email_accounts */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  if (!code) {
    return NextResponse.json({ error: 'Missing code' }, { status: 400 });
  }

  try {
    const { refresh_token, email } = await exchangeCodeForTokens(code);

    const supabase = getServiceClient();
    const { error } = await supabase
      .from('email_accounts')
      .upsert(
        {
          email,
          gmail_refresh_token: refresh_token,
          display_name: email.split('@')[0],
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'email' }
      );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Redirect back to admin email settings
    const baseUrl = req.nextUrl.origin;
    return NextResponse.redirect(`${baseUrl}/admin/email-queue?connected=${email}`);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
