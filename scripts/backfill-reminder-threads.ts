/**
 * Backfill for reminder-thread regression.
 *
 * Two passes:
 *   (A) For every outbound email_messages row missing `message_id_header`,
 *       fetch the real Message-ID header from Gmail and persist it.
 *   (B) Re-compute existing pending/escalated reminder drafts' `draft_subject`
 *       + `in_reply_to` using the now-complete thread info.
 *
 * Safe to re-run. Processes only rows that still need work.
 *
 * Usage:
 *   npx tsx scripts/backfill-reminder-threads.ts            # dry run
 *   npx tsx scripts/backfill-reminder-threads.ts --apply    # write changes
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Load .env.local ─────────────────────────────────────────────
try {
  for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    if (!process.env[t.slice(0, eq).trim()]) process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
} catch {}

import { getEmailById } from "../src/lib/gmail";
import { getThreadInfo, toReplySubject } from "../src/lib/email-service";

const APPLY = process.argv.includes("--apply");
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function passA_outboundMessageIds() {
  console.log(`\n=== Pass A: backfill outbound message_id_header ===`);

  const { data: accounts } = await db
    .from("email_accounts")
    .select("id, email, gmail_refresh_token");
  const accountsById = new Map((accounts || []).map((a) => [a.id, a]));

  const { data: rows } = await db
    .from("email_messages")
    .select("id, email_account_id, gmail_message_id")
    .eq("direction", "outbound")
    .is("message_id_header", null)
    .not("gmail_message_id", "is", null);

  console.log(`  candidates: ${rows?.length || 0}`);
  let ok = 0;
  let fail = 0;

  for (const row of rows || []) {
    const account = accountsById.get(row.email_account_id);
    if (!account?.gmail_refresh_token) {
      console.log(`  [skip] ${row.id.slice(0, 8)} — no refresh token`);
      fail++;
      continue;
    }
    try {
      const email = await getEmailById(account.gmail_refresh_token, row.gmail_message_id!);
      const header = email.messageIdHeader || null;
      if (!header) {
        console.log(`  [skip] ${row.id.slice(0, 8)} — Gmail returned no Message-ID`);
        fail++;
        continue;
      }
      console.log(`  [ok]   ${row.id.slice(0, 8)} → ${header.slice(0, 60)}`);
      if (APPLY) {
        const { error } = await db
          .from("email_messages")
          .update({ message_id_header: header })
          .eq("id", row.id);
        if (error) {
          console.log(`    update failed: ${error.message}`);
          fail++;
          continue;
        }
      }
      ok++;
    } catch (e: any) {
      console.log(`  [fail] ${row.id.slice(0, 8)} — ${e.message || e}`);
      fail++;
    }
  }

  console.log(`  pass A: ${ok} ok / ${fail} fail`);
}

/** Resolve canonical subject + latest in-reply-to for a *specific* thread. */
async function resolveThreadContext(threadId: string): Promise<{
  originalSubject: string | null;
  inReplyTo: string | null;
}> {
  const [{ data: first }, { data: latest }] = await Promise.all([
    db
      .from("email_messages")
      .select("subject")
      .eq("gmail_thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(1),
    db
      .from("email_messages")
      .select("message_id_header")
      .eq("gmail_thread_id", threadId)
      .not("message_id_header", "is", null)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  return {
    originalSubject: first?.[0]?.subject || null,
    inReplyTo: latest?.[0]?.message_id_header || null,
  };
}

async function passB_reminderDrafts() {
  console.log(`\n=== Pass B: rewrite reminder draft_subject + in_reply_to ===`);

  const { data: drafts } = await db
    .from("email_drafts")
    .select("id, project_creator_id, draft_subject, gmail_thread_id, in_reply_to, status")
    .eq("classification", "reminder")
    .in("status", ["pending", "escalated"]);

  console.log(`  candidates: ${drafts?.length || 0}`);
  let rewrote = 0;
  let unchanged = 0;
  let noThread = 0;

  for (const d of drafts || []) {
    // Preserve the draft's original thread if it has one; otherwise discover from pc.
    let threadId: string | null = d.gmail_thread_id || null;
    let ctx: { originalSubject: string | null; inReplyTo: string | null };

    if (threadId) {
      ctx = await resolveThreadContext(threadId);
    } else {
      if (!d.project_creator_id) {
        unchanged++;
        continue;
      }
      const info = await getThreadInfo(d.project_creator_id);
      threadId = info.gmailThreadId;
      ctx = { originalSubject: info.originalSubject, inReplyTo: info.inReplyTo };
    }

    if (!threadId || !ctx.originalSubject) {
      console.log(`  [skip] ${d.id.slice(0, 8)} — no thread info`);
      noThread++;
      continue;
    }

    const newSubject = toReplySubject(ctx.originalSubject);
    const newInReplyTo = ctx.inReplyTo;

    const subjectChanged = d.draft_subject !== newSubject;
    const inReplyToChanged = (d.in_reply_to || null) !== (newInReplyTo || null);
    const threadChanged = (d.gmail_thread_id || null) !== threadId;

    if (!subjectChanged && !inReplyToChanged && !threadChanged) {
      unchanged++;
      continue;
    }

    console.log(`  [fix]  ${d.id.slice(0, 8)}`);
    if (subjectChanged) console.log(`     subject: "${d.draft_subject}" → "${newSubject}"`);
    if (inReplyToChanged) console.log(`     in_reply_to: ${d.in_reply_to || "NULL"} → ${newInReplyTo || "NULL"}`);
    if (threadChanged) console.log(`     thread:  ${d.gmail_thread_id || "NULL"} → ${threadId}`);

    if (APPLY) {
      const { error } = await db
        .from("email_drafts")
        .update({
          draft_subject: newSubject,
          in_reply_to: newInReplyTo,
          gmail_thread_id: threadId,
        })
        .eq("id", d.id);
      if (error) {
        console.log(`     update failed: ${error.message}`);
        continue;
      }
    }
    rewrote++;
  }

  console.log(`  pass B: ${rewrote} rewritten / ${unchanged} unchanged / ${noThread} no-thread`);
}

async function main() {
  console.log(APPLY ? "MODE: --apply (writing)" : "MODE: dry-run (no writes)");
  await passA_outboundMessageIds();
  await passB_reminderDrafts();
  console.log(`\nDone.${APPLY ? "" : " Re-run with --apply to persist."}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
