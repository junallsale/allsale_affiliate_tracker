import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServer } from '@/lib/supabase-server';
import { isDemoBrandId } from '@/lib/demo';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/** GET /api/emails/unmatched — Inbound emails with no project_creator match, plus suggestions */
export async function GET(req: NextRequest) {
  try {
    const authSupabase = await createSupabaseServer();
    const { data: { user } } = await authSupabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const supabase = getServiceClient();
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '100');

    // 1. Fetch unmatched inbound emails
    const { data: emails, error } = await supabase
      .from('email_messages')
      .select('id, from_email, to_email, subject, body_text, body_html, received_at, gmail_thread_id')
      .is('project_creator_id', null)
      .eq('direction', 'inbound')
      .order('received_at', { ascending: false })
      .limit(limit);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!emails?.length) return NextResponse.json([]);

    // 2. Collect unique from_emails and batch-fetch possible creator matches
    const uniqueEmails = [...new Set(emails.map(e => e.from_email.toLowerCase()))];
    const suggestionsByEmail: Record<string, Array<{
      project_creator_id: string;
      creator_name: string;
      brand_name: string;
      project_name: string;
    }>> = {};

    if (uniqueEmails.length) {
      // Find creators matching these emails
      const { data: creators } = await supabase
        .from('creators')
        .select('id, name, tiktok_handle, email')
        .in('email', uniqueEmails);

      if (creators?.length) {
        const creatorIds = creators.map(c => c.id);

        // Find all project_creators for these creators
        const { data: pcs } = await supabase
          .from('project_creators')
          .select('id, creator_id, project:projects(name, brand_id, brand:brands(name))')
          .in('creator_id', creatorIds)
          .or('is_deleted.is.null,is_deleted.eq.false')
          .order('created_at', { ascending: false });

        // Build email → suggestions map (exclude demo brand)
        for (const creator of creators) {
          const email = creator.email?.toLowerCase();
          if (!email) continue;
          const creatorPcs = (pcs || []).filter(
            (pc: any) => pc.creator_id === creator.id && !isDemoBrandId((pc.project as any)?.brand_id)
          );
          suggestionsByEmail[email] = creatorPcs.map((pc: any) => ({
            project_creator_id: pc.id,
            creator_name: creator.tiktok_handle || creator.name || 'Unknown',
            brand_name: (pc.project as any)?.brand?.name || '',
            project_name: (pc.project as any)?.name || '',
          }));
        }
      }
    }

    // 3. Enrich emails with suggestions
    const enriched = emails.map(e => ({
      ...e,
      suggestions: suggestionsByEmail[e.from_email.toLowerCase()] || [],
    }));

    return NextResponse.json(enriched);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
