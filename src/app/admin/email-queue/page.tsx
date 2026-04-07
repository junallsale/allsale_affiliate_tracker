'use client';

import React, { useEffect, useState, useMemo, useCallback, lazy, Suspense } from 'react';
import { createSupabaseBrowser } from '@/lib/supabase-browser';

const RichTextEditor = lazy(() => import('@/components/ui/RichTextEditor'));
import {
  Mail, Send, X, AlertTriangle, Check, Loader2, Search, ExternalLink, Plus, RefreshCw, Inbox, ChevronDown, ChevronUp,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface EmailAccount {
  id: string;
  email: string;
  display_name: string;
  is_active: boolean;
}

interface EmailDraft {
  id: string;
  draft_subject: string;
  draft_body_html: string;
  classification: string | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  email_message: {
    id: string;
    from_email: string;
    to_email: string;
    subject: string;
    body_text: string;
    received_at: string;
    gmail_thread_id: string;
  } | null;
  project_creator: {
    id: string;
    unique_slug: string;
    creator: { name: string; tiktok_handle: string } | null;
    project: { name: string; brand: { name: string } | null } | null;
  } | null;
}

const classificationColors: Record<string, string> = {
  price_negotiation: 'bg-amber-100 text-amber-700',
  interest: 'bg-emerald-100 text-emerald-700',
  sample_request: 'bg-blue-100 text-blue-700',
  content_brief: 'bg-purple-100 text-purple-700',
  contract_modification: 'bg-red-100 text-red-700',
  shipping_info: 'bg-orange-100 text-orange-700',
  reminder: 'bg-gray-100 text-gray-700',
  other: 'bg-muted text-muted-foreground',
};

export default function EmailQueuePage() {
  const supabase = useMemo(() => createSupabaseBrowser(), []);
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [search, setSearch] = useState('');

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Polling
  const [polling, setPolling] = useState(false);
  const [pollResult, setPollResult] = useState<string | null>(null);

  // Send dialog
  const [sendDraft, setSendDraft] = useState<EmailDraft | null>(null);
  const [sendAccountId, setSendAccountId] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [sending, setSending] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);

    // Fetch drafts — simple query first, then enrich with related data
    let query = supabase
      .from('email_drafts')
      .select('id, draft_subject, draft_body_html, classification, status, created_at, reviewed_at, email_message_id, project_creator_id')
      .order('created_at', { ascending: false })
      .limit(100);

    if (statusFilter) query = query.eq('status', statusFilter);

    const { data: rawDrafts } = await query;

    // Enrich each draft with related data
    const enriched: EmailDraft[] = [];
    for (const d of rawDrafts || []) {
      let emailMessage = null;
      let projectCreator = null;

      if (d.email_message_id) {
        const { data: em } = await supabase
          .from('email_messages')
          .select('id, from_email, to_email, subject, body_text, received_at, gmail_thread_id')
          .eq('id', d.email_message_id)
          .single();
        emailMessage = em;
      }

      if (d.project_creator_id) {
        const { data: pc } = await supabase
          .from('project_creators')
          .select('id, unique_slug')
          .eq('id', d.project_creator_id)
          .single();

        if (pc) {
          // Fetch creator and project separately
          const { data: fullPc } = await supabase
            .from('project_creators')
            .select('creator:creators(name, tiktok_handle), project:projects(name, brand:brands(name))')
            .eq('id', pc.id)
            .single();

          projectCreator = {
            ...pc,
            creator: (fullPc as any)?.creator || null,
            project: (fullPc as any)?.project || null,
          };
        }
      }

      enriched.push({
        ...d,
        email_message: emailMessage,
        project_creator: projectCreator,
      } as EmailDraft);
    }
    setDrafts(enriched);

    // Fetch email accounts
    const res = await fetch('/api/email-accounts');
    if (res.ok) {
      const accts = await res.json();
      setAccounts(accts);
      if (accts.length > 0 && !sendAccountId) setSendAccountId(accts[0].id);
    }

    setLoading(false);
  }, [supabase, statusFilter, sendAccountId]);

  const pollNow = useCallback(async () => {
    setPolling(true);
    setPollResult(null);
    try {
      const res = await fetch('/api/cron/poll-emails');
      const data = await res.json();
      if (res.ok) {
        setPollResult(`Polled: ${data.processed || 0} emails, ${data.drafts || 0} drafts, ${data.escalated || 0} escalated`);
        await fetchData();
      } else {
        setPollResult(data.error || 'Poll failed');
      }
    } catch {
      setPollResult('Poll failed');
    }
    setPolling(false);
  }, [fetchData]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    if (!search) return drafts;
    const q = search.toLowerCase();
    return drafts.filter(d => {
      const pc = d.project_creator;
      const em = d.email_message;
      return (
        (pc?.creator?.tiktok_handle || '').toLowerCase().includes(q) ||
        (pc?.creator?.name || '').toLowerCase().includes(q) ||
        (em?.from_email || '').toLowerCase().includes(q) ||
        (d.draft_subject || '').toLowerCase().includes(q) ||
        (d.classification || '').toLowerCase().includes(q)
      );
    });
  }, [drafts, search]);

  const openSendDialog = (draft: EmailDraft) => {
    setSendDraft(draft);
    setEditSubject(draft.draft_subject || '');
    setEditBody(draft.draft_body_html || '');
  };

  const handleSend = async () => {
    if (!sendDraft || !sendAccountId) return;
    setSending(true);

    try {
      const toEmail = sendDraft.email_message?.from_email || '';
      const res = await fetch('/api/emails/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailAccountId: sendAccountId,
          to: toEmail,
          subject: editSubject,
          bodyHtml: editBody,
          projectCreatorId: sendDraft.project_creator?.id,
          threadId: sendDraft.email_message?.gmail_thread_id,
        }),
      });

      if (res.ok) {
        // Update draft status
        await supabase
          .from('email_drafts')
          .update({ status: 'sent', reviewed_at: new Date().toISOString() })
          .eq('id', sendDraft.id);

        setSendDraft(null);
        fetchData();
      }
    } catch (err) {
      console.error('Send failed:', err);
    } finally {
      setSending(false);
    }
  };

  const updateDraftStatus = async (draftId: string, status: 'dismissed' | 'escalated') => {
    await supabase
      .from('email_drafts')
      .update({ status, reviewed_at: new Date().toISOString() })
      .eq('id', draftId);

    if (status === 'escalated') {
      const draft = drafts.find(d => d.id === draftId);
      if (draft) {
        await fetch('/api/emails/escalate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reason: draft.classification || 'Manual escalation',
            creatorName: draft.project_creator?.creator?.tiktok_handle || 'Unknown',
            creatorEmail: draft.email_message?.from_email,
            projectName: draft.project_creator?.project?.name,
            emailSnippet: draft.email_message?.body_text,
          }),
        }).catch(() => {});
      }
    }

    fetchData();
  };

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { pending: 0, sent: 0, dismissed: 0, escalated: 0 };
    // We need all drafts for counts, but we only have filtered ones
    // This is approximate; for exact counts we'd need a separate query
    return counts;
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <TooltipProvider>
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Mail className="w-6 h-6" /> Email Queue
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review AI-generated email drafts and send or dismiss
          </p>
        </div>
        <div className="flex gap-2">
          {accounts.length === 0 ? (
            <Button size="sm" onClick={() => window.location.href = '/api/auth/gmail'}>
              <Plus className="w-4 h-4 mr-2" /> Connect Gmail
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {accounts.filter(a => a.is_active).length} account(s) connected
              </Badge>
              <Button variant="outline" size="sm" onClick={() => window.location.href = '/api/auth/gmail'}>
                <Plus className="w-4 h-4 mr-1" /> Add
              </Button>
            </div>
          )}
          <Button variant="default" size="sm" onClick={pollNow} disabled={polling}>
            {polling ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Inbox className="w-4 h-4 mr-1" />}
            Poll Gmail
          </Button>
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search creator, email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-56 pl-8 text-sm"
          />
        </div>
        {['pending', 'sent', 'dismissed', 'escalated', ''].map(s => (
          <Button
            key={s || 'all'}
            variant={statusFilter === s ? 'default' : 'outline'}
            size="sm"
            className="h-8 text-xs"
            onClick={() => setStatusFilter(s)}
          >
            {s || 'All'}
          </Button>
        ))}
        <span className="text-xs text-muted-foreground">{filtered.length} items</span>
        {pollResult && (
          <span className="text-xs text-blue-600 font-medium">{pollResult}</span>
        )}
      </div>

      {/* Queue Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[calc(100vh-280px)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[140px]">Creator</TableHead>
                  <TableHead>Classification</TableHead>
                  <TableHead className="min-w-[200px]">Incoming Email</TableHead>
                  <TableHead className="min-w-[200px]">Draft Reply</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead className="text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                      {statusFilter === 'pending' ? 'No pending drafts — all caught up!' : 'No items found'}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map(d => {
                    const pc = d.project_creator;
                    const em = d.email_message;
                    const isExpanded = expandedId === d.id;
                    return (
                      <React.Fragment key={d.id}>
                        <TableRow
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setExpandedId(isExpanded ? null : d.id)}
                        >
                          {/* Creator */}
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                              <div>
                                <div className="text-sm font-medium">
                                  @{pc?.creator?.tiktok_handle || 'Unknown'}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {pc?.project?.brand?.name} / {pc?.project?.name}
                                </div>
                              </div>
                            </div>
                          </TableCell>

                          {/* Classification */}
                          <TableCell>
                            <span className={cn(
                              'px-2 py-0.5 rounded text-xs font-medium',
                              classificationColors[d.classification || 'other'] || classificationColors.other
                            )}>
                              {(d.classification || 'other').replace(/_/g, ' ')}
                            </span>
                          </TableCell>

                          {/* Incoming Email */}
                          <TableCell>
                            {em ? (
                              <div>
                                <div className="text-xs font-medium truncate max-w-[250px]">{em.subject}</div>
                                <div className="text-xs text-muted-foreground truncate max-w-[250px]">
                                  {em.body_text?.slice(0, 100)}
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground italic">Outbound draft</span>
                            )}
                          </TableCell>

                          {/* Draft Reply */}
                          <TableCell>
                            <div className="text-xs font-medium truncate max-w-[250px]">{d.draft_subject}</div>
                            <div className="text-xs text-muted-foreground truncate max-w-[250px]">
                              {d.draft_body_html?.replace(/<[^>]+>/g, '').slice(0, 100)}
                            </div>
                          </TableCell>

                          {/* Status */}
                          <TableCell>
                            <Badge variant={
                              d.status === 'pending' ? 'default' :
                              d.status === 'sent' ? 'secondary' :
                              d.status === 'escalated' ? 'destructive' : 'outline'
                            } className="text-xs">
                              {d.status}
                            </Badge>
                          </TableCell>

                          {/* Time */}
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(d.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </TableCell>

                          {/* Actions */}
                          <TableCell className="text-center">
                            <div className="flex gap-1 justify-center" onClick={(e) => e.stopPropagation()}>
                              {(d.status === 'pending' || d.status === 'escalated') && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant="default"
                                      className="h-7 text-xs"
                                      onClick={() => openSendDialog(d)}
                                    >
                                      <Send className="w-3 h-3 mr-1" /> Send
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Review and send this reply</TooltipContent>
                                </Tooltip>
                              )}
                              {d.status === 'pending' && (
                                <>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-xs"
                                        onClick={() => updateDraftStatus(d.id, 'dismissed')}
                                      >
                                        <X className="w-3 h-3" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Dismiss — no reply needed</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-xs text-red-600"
                                        onClick={() => updateDraftStatus(d.id, 'escalated')}
                                      >
                                        <AlertTriangle className="w-3 h-3" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Escalate to Slack for manual handling</TooltipContent>
                                  </Tooltip>
                                </>
                              )}
                              {d.status === 'sent' && (
                                <Check className="w-4 h-4 text-emerald-600" />
                              )}
                              {d.status === 'dismissed' && (
                                <span className="text-xs text-muted-foreground">dismissed</span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>

                        {/* Expanded Detail Row */}
                        {isExpanded && (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={7} className="p-0">
                              <div className="grid grid-cols-2 gap-4 p-4">
                                {/* Incoming Email */}
                                <div className="border rounded-lg p-4 bg-background">
                                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Incoming Email</h4>
                                  {em ? (
                                    <>
                                      <div className="text-xs text-muted-foreground mb-1">From: {em.from_email}</div>
                                      <div className="text-sm font-medium mb-2">{em.subject}</div>
                                      <div className="text-sm whitespace-pre-wrap border-t pt-2 max-h-[300px] overflow-y-auto">
                                        {em.body_text || <span className="text-muted-foreground italic">No text content</span>}
                                      </div>
                                    </>
                                  ) : (
                                    <p className="text-sm text-muted-foreground italic">No incoming email — this is an outbound draft</p>
                                  )}
                                </div>

                                {/* Draft Reply */}
                                <div className="border rounded-lg p-4 bg-background">
                                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Draft Reply</h4>
                                  <div className="text-sm font-medium mb-2">{d.draft_subject}</div>
                                  <div
                                    className="text-sm border-t pt-2 max-h-[300px] overflow-y-auto prose prose-sm"
                                    dangerouslySetInnerHTML={{ __html: d.draft_body_html || '' }}
                                  />
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Send Dialog */}
      <Dialog open={!!sendDraft} onOpenChange={(open) => { if (!open) setSendDraft(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Review & Send Email — @{sendDraft?.project_creator?.creator?.tiktok_handle}
            </DialogTitle>
          </DialogHeader>

          {sendDraft?.email_message && (
            <div className="bg-muted/50 rounded-lg p-3 text-sm">
              <div className="font-medium text-xs text-muted-foreground mb-1">Original email from creator:</div>
              <div className="font-medium">{sendDraft.email_message.subject}</div>
              <div className="text-muted-foreground mt-1 text-xs whitespace-pre-wrap">
                {sendDraft.email_message.body_text?.slice(0, 500)}
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Send from</label>
              <select
                className="flex h-9 w-full rounded-md border px-3 py-1 text-sm bg-background mt-1"
                value={sendAccountId}
                onChange={(e) => setSendAccountId(e.target.value)}
              >
                {accounts.filter(a => a.is_active).map(a => (
                  <option key={a.id} value={a.id}>{a.email}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium">To</label>
              <Input
                value={sendDraft?.email_message?.from_email || ''}
                disabled
                className="h-9 mt-1 text-sm bg-muted"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Subject</label>
              <Input
                value={editSubject}
                onChange={(e) => setEditSubject(e.target.value)}
                className="h-9 mt-1 text-sm"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Body</label>
              <div className="mt-1">
                <Suspense fallback={<div className="h-[200px] border rounded-md flex items-center justify-center text-muted-foreground text-sm">Loading editor...</div>}>
                  <RichTextEditor value={editBody} onChange={setEditBody} placeholder="Edit your reply..." />
                </Suspense>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSendDraft(null)}>Cancel</Button>
            <Button onClick={handleSend} disabled={sending || !sendAccountId}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
              Send Email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  );
}
