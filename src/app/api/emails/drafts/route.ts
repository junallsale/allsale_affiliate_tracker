import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServer } from '@/lib/supabase-server';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/** GET /api/emails/drafts?status=pending&limit=100 — Optimized draft fetch (3 queries total) */
export async function GET(req: NextRequest) {
  try {
    const authSupabase = await createSupabaseServer();
    const { data: { user } } = await authSupabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const supabase = getServiceClient();
    const status = req.nextUrl.searchParams.get('status') || '';
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '100');

    // 1. Fetch drafts
    let query = supabase
      .from('email_drafts')
      .select('id, draft_subject, draft_body_html, classification, status, created_at, reviewed_at, email_message_id, project_creator_id, gmail_thread_id, in_reply_to')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status) query = query.eq('status', status);

    const { data: drafts, error: draftsError } = await query;
    if (draftsError) return NextResponse.json({ error: draftsError.message }, { status: 500 });
    if (!drafts?.length) return NextResponse.json([]);

    // 2. Batch fetch email_messages
    const messageIds = [...new Set(drafts.map(d => d.email_message_id).filter(Boolean))] as string[];
    const messagesMap: Record<string, any> = {};

    if (messageIds.length > 0) {
      const { data: messages } = await supabase
        .from('email_messages')
        .select('id, from_email, to_email, subject, body_text, body_html, received_at, gmail_thread_id, message_id_header, cc_emails')
        .in('id', messageIds);

      for (const m of messages || []) {
        messagesMap[m.id] = m;
      }
    }

    // 3. Batch fetch project_creators with joins
    const pcIds = [...new Set(drafts.map(d => d.project_creator_id).filter(Boolean))] as string[];
    const pcMap: Record<string, any> = {};

    if (pcIds.length > 0) {
      const { data: pcs } = await supabase
        .from('project_creators')
        .select('id, unique_slug, creator:creators(name, tiktok_handle), project:projects(name, brand:brands(name))')
        .in('id', pcIds);

      for (const pc of pcs || []) {
        pcMap[pc.id] = {
          id: pc.id,
          unique_slug: pc.unique_slug,
          creator: (pc as any).creator || null,
          project: (pc as any).project || null,
        };
      }
    }

    // 4. Batch lookup: for each thread, find the outbound sender account
    //    so the UI can default to the same "Send from" account on replies.
    const threadIds = [...new Set(
      drafts
        .map(d => d.gmail_thread_id || (d.email_message_id ? messagesMap[d.email_message_id]?.gmail_thread_id : null))
        .filter(Boolean)
    )] as string[];
    const threadSenderMap: Record<string, string> = {}; // gmail_thread_id → email_account_id

    if (threadIds.length > 0) {
      const { data: outboundRows } = await supabase
        .from('email_messages')
        .select('gmail_thread_id, email_account_id')
        .in('gmail_thread_id', threadIds)
        .eq('direction', 'outbound')
        .not('email_account_id', 'is', null)
        .order('created_at', { ascending: true }); // first outbound = the original sender

      for (const row of outboundRows || []) {
        const tid = row.gmail_thread_id as string;
        if (!threadSenderMap[tid]) threadSenderMap[tid] = row.email_account_id;
      }
    }

    // 5. Combine
    const enriched = drafts.map(d => {
      const threadId = d.gmail_thread_id || (d.email_message_id ? messagesMap[d.email_message_id]?.gmail_thread_id : null);
      return {
        ...d,
        email_message: d.email_message_id ? (messagesMap[d.email_message_id] || null) : null,
        project_creator: d.project_creator_id ? (pcMap[d.project_creator_id] || null) : null,
        thread_sender_account_id: threadId ? (threadSenderMap[threadId] || null) : null,
      };
    });

    return NextResponse.json(enriched);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
