'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import {
  Mail, Send, X, AlertTriangle, Check, Loader2, Search, ExternalLink, Plus, RefreshCw,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
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

  // Send dialog
  const [sendDraft, setSendDraft] = useState<EmailDraft | null>(null);
  const [sendAccountId, setSendAccountId] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [sending, setSending] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);

    // Fetch drafts with related data
    let query = supabase
      .from('email_drafts')
      .select(`
        id, draft_subject, draft_body_html, classification, status, created_at, reviewed_at,
        email_message:email_messages(id, from_email, to_email, subject, body_text, received_at, gmail_thread_id),
        project_creator:project_creators(id, unique_slug, creator:creators(name, tiktok_handle), project:projects(name, brand:brands(name)))
      `)
      .order('created_at', { ascending: false })
      .limit(100);

    if (statusFilter) query = query.eq('status', statusFilter);

    const { data: draftData } = await query;
    if (draftData) setDrafts(draftData as unknown as EmailDraft[]);

    // Fetch email accounts
    const res = await fetch('/api/email-accounts');
    if (res.ok) {
      const accts = await res.json();
      setAccounts(accts);
      if (accts.length > 0 && !sendAccountId) setSendAccountId(accts[0].id);
    }

    setLoading(false);
  }, [supabase, statusFilter, sendAccountId]);

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
                    return (
                      <TableRow key={d.id}>
                        {/* Creator */}
                        <TableCell>
                          <div className="text-sm font-medium">
                            @{pc?.creator?.tiktok_handle || 'Unknown'}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {pc?.project?.brand?.name} / {pc?.project?.name}
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
                          {d.status === 'pending' && (
                            <div className="flex gap-1 justify-center">
                              <Button
                                size="sm"
                                variant="default"
                                className="h-7 text-xs"
                                onClick={() => openSendDialog(d)}
                              >
                                <Send className="w-3 h-3 mr-1" /> Send
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => updateDraftStatus(d.id, 'dismissed')}
                              >
                                <X className="w-3 h-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs text-red-600"
                                onClick={() => updateDraftStatus(d.id, 'escalated')}
                              >
                                <AlertTriangle className="w-3 h-3" />
                              </Button>
                            </div>
                          )}
                          {d.status === 'sent' && (
                            <Check className="w-4 h-4 text-emerald-600 mx-auto" />
                          )}
                        </TableCell>
                      </TableRow>
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
              <textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                className="flex w-full rounded-md border px-3 py-2 text-sm bg-background mt-1 min-h-[200px] resize-y"
              />
              <p className="text-xs text-muted-foreground mt-1">HTML supported. Edit the draft before sending.</p>
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
  );
}
