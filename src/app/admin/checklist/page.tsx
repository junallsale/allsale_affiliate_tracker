'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2, ClipboardCheck, MessageSquareText, StickyNote, ExternalLink,
  FileText, PenLine, Package, Check, Bell, Video, AlertCircle,
} from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';

import { cn } from '@/lib/utils';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import MemoDialog from './MemoDialog';

// ── Types ────────────────────────────────────────────────────────────────
interface ChecklistRow {
  id: string;
  project_id: string;
  creator_id: string;
  contract_sent: boolean;
  contract_sent_at: string | null;
  signed_at: string | null;
  sample_shipped: boolean;
  communication_link: string | null;
  contact_point: string | null;
  created_at: string;
  creators: {
    id: string;
    name: string;
    tiktok_handle: string;
    email: string;
  };
  projects: {
    id: string;
    name: string;
    brand_id: string;
    brands: { id: string; name: string; slug: string };
  };
  assigned_video_count: number;
  advance_payment: number;
  project_creator_memos: { id: string }[];
  project_creator_reminds: { id: string; remind_date: string; note: string | null; author_name: string | null; created_at: string }[];
  project_creator_reviews: { id: string; review_date: string; note: string | null; status: string; author_name: string | null; resolve_note: string | null; created_at: string }[];
  payments: { id: string; amount: number }[];
  videos: { id: string; status: string }[];
  posting_confirmed: boolean;
}

type TabType = 'contract' | 'signature' | 'sample' | 'video' | 'review' | 'posting';

// ── Helpers ──────────────────────────────────────────────────────────────
function getDaysElapsed(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function getDaysColor(days: number): string {
  if (days < 3) return 'text-emerald-600';
  if (days <= 7) return 'text-amber-600';
  return 'text-red-600';
}

function getDaysBadgeVariant(days: number): 'default' | 'secondary' | 'destructive' {
  if (days < 3) return 'secondary';
  if (days <= 7) return 'default';
  return 'destructive';
}

// ── Page ─────────────────────────────────────────────────────────────────
export default function ChecklistPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowser(), []);

  const [loading, setLoading] = useState(true);
  const [allRows, setAllRows] = useState<ChecklistRow[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('contract');

  // Memo dialog
  const [memoOpen, setMemoOpen] = useState(false);
  const [memoPcId, setMemoPcId] = useState('');
  const [memoCreatorName, setMemoCreatorName] = useState('');

  // Remind dialog
  const [remindOpen, setRemindOpen] = useState(false);
  const [remindPcId, setRemindPcId] = useState('');
  const [remindCreatorName, setRemindCreatorName] = useState('');
  const [remindForm, setRemindForm] = useState({ remind_date: new Date().toISOString().split('T')[0], note: '' });
  const [addingRemind, setAddingRemind] = useState(false);

  // ── Fetch data ──
  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('project_creators')
      .select(`
        id, project_id, creator_id, contract_sent, contract_sent_at,
        signed_at, sample_shipped, communication_link, contact_point,
        assigned_video_count, advance_payment, created_at, posting_confirmed,
        creators(id, name, tiktok_handle, email),
        projects(id, name, brand_id, brands(id, name, slug)),
        project_creator_memos(id),
        project_creator_reminds(id, remind_date, note, author_name, created_at),
        project_creator_reviews(id, review_date, note, status, author_name, resolve_note, created_at),
        payments(id, amount),
        videos(id, status)
      `)
      .or('is_deleted.is.null,is_deleted.eq.false')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Checklist fetch error:', error.message);
    } else {
      setAllRows((data as unknown as ChecklistRow[]) || []);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Filter by tab ──
  const contractNotSent = useMemo(
    () => allRows.filter(r => !r.contract_sent),
    [allRows],
  );
  const awaitingSignature = useMemo(
    () => allRows.filter(r => r.contract_sent && !r.signed_at),
    [allRows],
  );
  const sampleNotShipped = useMemo(
    () => allRows.filter(r => r.contract_sent && !!r.signed_at && !r.sample_shipped),
    [allRows],
  );
  const awaitingVideo = useMemo(
    () => allRows.filter(r => {
      if (!r.signed_at || !r.sample_shipped) return false;
      return (r.videos || []).filter(v => v.status !== 'rejected').length < (r.assigned_video_count || 1);
    }),
    [allRows],
  );
  const needsReview = useMemo(
    () => allRows.filter(r =>
      (r.project_creator_reviews || []).some(rv => rv.status === 'need_review' || rv.status === 'in_progress')
    ),
    [allRows],
  );
  const postingComplete = useMemo(
    () => allRows.filter(r => {
      if (r.posting_confirmed) return false;
      if (!r.signed_at) return false;
      const videoCount = (r.videos || []).filter(v => v.status !== 'rejected').length;
      return videoCount >= (r.assigned_video_count || 1);
    }),
    [allRows],
  );

  const currentRows = activeTab === 'contract'
    ? contractNotSent
    : activeTab === 'signature'
      ? awaitingSignature
      : activeTab === 'sample'
        ? sampleNotShipped
        : activeTab === 'video'
          ? awaitingVideo
          : activeTab === 'review'
            ? needsReview
            : activeTab === 'posting'
              ? postingComplete
              : sampleNotShipped;

  // ── Toggle handlers ──
  const handleToggleContractSent = async (pcId: string, value: boolean) => {
    try {
      const { error } = await supabase
        .from('project_creators')
        .update({ contract_sent: value, contract_sent_at: value ? new Date().toISOString() : null })
        .eq('id', pcId);
      if (error) throw error;
      setAllRows(prev => prev.map(r =>
        r.id === pcId ? { ...r, contract_sent: value, contract_sent_at: value ? new Date().toISOString() : null } : r
      ));
    } catch (err) {
      console.error('Error toggling contract sent:', err);
    }
  };

  const handleToggleSampleShipped = async (pcId: string, value: boolean) => {
    try {
      const { error } = await supabase
        .from('project_creators')
        .update({ sample_shipped: value })
        .eq('id', pcId);
      if (error) throw error;
      setAllRows(prev => prev.map(r =>
        r.id === pcId ? { ...r, sample_shipped: value } : r
      ));
    } catch (err) {
      console.error('Error toggling sample shipped:', err);
    }
  };

  const handleConfirmPosting = async (pcId: string) => {
    try {
      const { error } = await supabase
        .from('project_creators')
        .update({ posting_confirmed: true })
        .eq('id', pcId);
      if (error) throw error;
      setAllRows(prev => prev.map(r =>
        r.id === pcId ? { ...r, posting_confirmed: true } : r
      ));
    } catch (err) {
      console.error('Error confirming posting:', err);
    }
  };

  // ── Memo helpers ──
  const openMemo = (pcId: string, name: string) => {
    setMemoPcId(pcId);
    setMemoCreatorName(name);
    setMemoOpen(true);
  };

  const handleMemoCountChange = (pcId: string, count: number) => {
    setAllRows(prev => prev.map(r =>
      r.id === pcId
        ? { ...r, project_creator_memos: Array.from({ length: count }, (_, i) => ({ id: String(i) })) }
        : r
    ));
  };

  // ── Remind helpers ──
  const openRemind = (pcId: string, name: string) => {
    setRemindPcId(pcId);
    setRemindCreatorName(name);
    setRemindForm({ remind_date: new Date().toISOString().split('T')[0], note: '' });
    setRemindOpen(true);
  };

  const handleAddRemind = async () => {
    if (!remindPcId) return;
    try {
      setAddingRemind(true);
      const { data: { session } } = await supabase.auth.getSession();
      const authorName = session?.user?.email?.split('@')[0] || 'Unknown';
      const { error } = await supabase.from('project_creator_reminds').insert({
        project_creator_id: remindPcId,
        remind_date: remindForm.remind_date,
        note: remindForm.note.trim() || null,
        author_name: authorName,
      });
      if (error) throw error;
      const newRemind = {
        id: crypto.randomUUID(),
        remind_date: remindForm.remind_date,
        note: remindForm.note.trim() || null,
        author_name: authorName,
        created_at: new Date().toISOString(),
      };
      setAllRows(prev => prev.map(r =>
        r.id === remindPcId
          ? { ...r, project_creator_reminds: [...(r.project_creator_reminds || []), newRemind] }
          : r
      ));
      setRemindForm({ remind_date: new Date().toISOString().split('T')[0], note: '' });
    } catch (error) {
      console.error('Error adding remind:', error);
    } finally {
      setAddingRemind(false);
    }
  };

  // ── Review dialog ──
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewPcId, setReviewPcId] = useState('');
  const [reviewCreatorName, setReviewCreatorName] = useState('');
  const [reviewForm, setReviewForm] = useState({ review_date: new Date().toISOString().split('T')[0], note: '' });
  const [addingReview, setAddingReview] = useState(false);

  const openReview = (pcId: string, name: string) => {
    setReviewPcId(pcId);
    setReviewCreatorName(name);
    setReviewForm({ review_date: new Date().toISOString().split('T')[0], note: '' });
    setReviewOpen(true);
  };

  const handleAddReview = async () => {
    if (!reviewPcId || !reviewForm.note.trim()) return;
    try {
      setAddingReview(true);
      const { data: { session } } = await supabase.auth.getSession();
      const authorName = session?.user?.email?.split('@')[0] || 'Unknown';
      const { error } = await supabase.from('project_creator_reviews').insert({
        project_creator_id: reviewPcId,
        review_date: reviewForm.review_date,
        note: reviewForm.note.trim(),
        status: 'need_review',
        author_name: authorName,
      });
      if (error) throw error;
      const newReview = {
        id: crypto.randomUUID(),
        review_date: reviewForm.review_date,
        note: reviewForm.note.trim(),
        status: 'need_review',
        author_name: authorName,
        resolve_note: null as string | null,
        created_at: new Date().toISOString(),
      };
      setAllRows(prev => prev.map(r =>
        r.id === reviewPcId
          ? { ...r, project_creator_reviews: [...(r.project_creator_reviews || []), newReview] }
          : r
      ));
      setReviewForm({ review_date: new Date().toISOString().split('T')[0], note: '' });
    } catch (error) {
      console.error('Error adding review:', error);
    } finally {
      setAddingReview(false);
    }
  };

  // Status change dialog (resolve or request info)
  const [statusChangeTarget, setStatusChangeTarget] = useState<{ reviewId: string; pcId: string; newStatus: 'resolved' | 'in_progress' } | null>(null);
  const [statusChangeNote, setStatusChangeNote] = useState('');
  const [changingStatus, setChangingStatus] = useState(false);

  const handleStatusChange = async () => {
    if (!statusChangeTarget) return;
    try {
      setChangingStatus(true);
      const { newStatus } = statusChangeTarget;
      const { error } = await supabase.from('project_creator_reviews').update({
        status: newStatus,
        resolve_note: statusChangeNote.trim() || null,
      }).eq('id', statusChangeTarget.reviewId);
      if (!error) {
        const row = allRows.find(r => r.id === statusChangeTarget.pcId);
        const review = row?.project_creator_reviews?.find(rv => rv.id === statusChangeTarget.reviewId);
        const { data: { session } } = await supabase.auth.getSession();
        const currentUser = session?.user?.email?.split('@')[0] || 'Someone';

        if (review?.author_name && review.author_name !== currentUser) {
          const brandSlug = row?.projects?.brands?.slug;
          await supabase.from('notifications').insert({
            recipient: review.author_name,
            type: newStatus === 'resolved' ? 'review_resolved' : 'review_info_requested',
            title: newStatus === 'resolved' ? `Review resolved by ${currentUser}` : `${currentUser} requested more info`,
            body: statusChangeNote.trim() || null,
            link: brandSlug ? `/admin/brands/${brandSlug}/projects/${row?.project_id}/creators/${statusChangeTarget.pcId}` : null,
          });
        }

        setAllRows(prev => prev.map(r =>
          r.id === statusChangeTarget.pcId
            ? { ...r, project_creator_reviews: (r.project_creator_reviews || []).map(rv =>
                rv.id === statusChangeTarget.reviewId ? { ...rv, status: newStatus, resolve_note: statusChangeNote.trim() || null } : rv
              ) }
            : r
        ));
      }
      setStatusChangeTarget(null);
      setStatusChangeNote('');
    } catch (error) {
      console.error('Error changing review status:', error);
    } finally {
      setChangingStatus(false);
    }
  };

  const handleReopenReview = async (reviewId: string, pcId: string) => {
    const { error } = await supabase.from('project_creator_reviews').update({ status: 'need_review' }).eq('id', reviewId);
    if (!error) {
      setAllRows(prev => prev.map(r =>
        r.id === pcId
          ? { ...r, project_creator_reviews: (r.project_creator_reviews || []).map(rv => rv.id === reviewId ? { ...rv, status: 'need_review' } : rv) }
          : r
      ));
    }
  };

  // ── Row click → PC detail ──
  const goToDetail = (row: ChecklistRow) => {
    const brandSlug = row.projects?.brands?.slug;
    if (!brandSlug) return;
    router.push(`/admin/brands/${brandSlug}/projects/${row.project_id}/creators/${row.id}`);
  };

  // ── Loading ──
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
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardCheck className="w-6 h-6" />
          Checklist
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Track contract, signature, and sample status across all projects
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center">
                <FileText className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{contractNotSent.length}</p>
                <p className="text-xs text-muted-foreground">Contract Not Sent</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center">
                <PenLine className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{awaitingSignature.length}</p>
                <p className="text-xs text-muted-foreground">Awaiting Signature</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-purple-100 flex items-center justify-center">
                <Package className="w-4 h-4 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{sampleNotShipped.length}</p>
                <p className="text-xs text-muted-foreground">Sample Not Shipped</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-orange-100 flex items-center justify-center">
                <Video className="w-4 h-4 text-orange-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{awaitingVideo.length}</p>
                <p className="text-xs text-muted-foreground">Awaiting Video</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center">
                <AlertCircle className="w-4 h-4 text-red-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{needsReview.length}</p>
                <p className="text-xs text-muted-foreground">Needs Review</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center">
                <Check className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{postingComplete.length}</p>
                <p className="text-xs text-muted-foreground">Posting Complete</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabType)}>
        <TabsList>
          <TabsTrigger value="contract" className="text-xs">
            Contract Not Sent ({contractNotSent.length})
          </TabsTrigger>
          <TabsTrigger value="signature" className="text-xs">
            Awaiting Signature ({awaitingSignature.length})
          </TabsTrigger>
          <TabsTrigger value="sample" className="text-xs">
            Sample Not Shipped ({sampleNotShipped.length})
          </TabsTrigger>
          <TabsTrigger value="video" className="text-xs">
            Awaiting Video ({awaitingVideo.length})
          </TabsTrigger>
          <TabsTrigger value="review" className="text-xs">
            Needs Review ({needsReview.length})
          </TabsTrigger>
          <TabsTrigger value="posting" className="text-xs">
            Posting Complete ({postingComplete.length})
          </TabsTrigger>
        </TabsList>

        {/* Shared table content */}
        <TabsContent value={activeTab} className="mt-4">
          {currentRows.length === 0 ? (
            <Card>
              <CardContent className="py-12">
                <p className="text-center text-muted-foreground text-sm">
                  No items in this category
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    {/* Checkbox column for contract / sample tabs */}
                    {(activeTab === 'contract' || activeTab === 'sample') && (
                      <TableHead className="text-center w-[50px]">
                        {activeTab === 'contract' ? 'Contract' : 'Sample'}
                      </TableHead>
                    )}
                    {activeTab === 'posting' && (
                      <TableHead className="text-center w-[80px]">Confirm</TableHead>
                    )}
                    <TableHead className="w-[180px]">Brand / Project</TableHead>
                    <TableHead>Creator</TableHead>
                    <TableHead>TikTok</TableHead>
                    <TableHead className="w-[100px]">Contact</TableHead>
                    <TableHead className="text-center w-[50px]">Comm</TableHead>
                    {activeTab !== 'contract' && (
                      <TableHead className="text-center w-[70px]">Days</TableHead>
                    )}
                    <TableHead className="w-[140px]">Remind</TableHead>
                    <TableHead className="w-[140px]">Review</TableHead>
                    <TableHead className="text-center w-[50px]">Memo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {currentRows.map(row => {
                    const brand = row.projects?.brands;
                    const project = row.projects;
                    const creator = row.creators;
                    const hasMemos = (row.project_creator_memos?.length || 0) > 0;

                    // Days elapsed
                    let days: number | null = null;
                    if (activeTab === 'signature') {
                      days = getDaysElapsed(row.contract_sent_at);
                    } else if (activeTab === 'sample') {
                      days = getDaysElapsed(row.signed_at);
                    }

                    return (
                      <TableRow
                        key={row.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => goToDetail(row)}
                      >
                        {/* Checkbox: Contract Sent / Sample Shipped */}
                        {activeTab === 'contract' && (
                          <TableCell className="text-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleContractSent(row.id, !row.contract_sent);
                              }}
                              className={cn(
                                'w-5 h-5 rounded border-2 flex items-center justify-center transition-colors mx-auto',
                                row.contract_sent
                                  ? 'bg-blue-500 border-blue-500'
                                  : 'border-muted-foreground/30 hover:border-blue-400'
                              )}
                            >
                              {row.contract_sent && <Check className="w-3 h-3 text-white" />}
                            </button>
                          </TableCell>
                        )}
                        {activeTab === 'sample' && (
                          <TableCell className="text-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleSampleShipped(row.id, !row.sample_shipped);
                              }}
                              className={cn(
                                'w-5 h-5 rounded border-2 flex items-center justify-center transition-colors mx-auto',
                                row.sample_shipped
                                  ? 'bg-emerald-500 border-emerald-500'
                                  : 'border-muted-foreground/30 hover:border-emerald-400'
                              )}
                            >
                              {row.sample_shipped && <Check className="w-3 h-3 text-white" />}
                            </button>
                          </TableCell>
                        )}
                        {activeTab === 'posting' && (
                          <TableCell className="text-center">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleConfirmPosting(row.id);
                              }}
                            >
                              <Check className="w-3 h-3 mr-1" />
                              Confirm
                            </Button>
                          </TableCell>
                        )}

                        {/* Brand / Project */}
                        <TableCell>
                          <div>
                            <p className="text-sm font-medium">{brand?.name || '-'}</p>
                            <p className="text-xs text-muted-foreground">{project?.name || '-'}</p>
                          </div>
                        </TableCell>

                        {/* Creator */}
                        <TableCell className="text-sm font-medium">
                          {creator?.name || '-'}
                        </TableCell>

                        {/* TikTok */}
                        <TableCell>
                          {creator?.tiktok_handle ? (
                            <a
                              href={`https://www.tiktok.com/@${creator.tiktok_handle}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                            >
                              @{creator.tiktok_handle}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>

                        {/* Contact Point */}
                        <TableCell>
                          {row.contact_point ? (
                            <span className="text-xs text-muted-foreground truncate max-w-[100px] block">{row.contact_point}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground/30">-</span>
                          )}
                        </TableCell>

                        {/* Communication Link */}
                        <TableCell className="text-center">
                          {row.communication_link ? (
                            <a
                              href={row.communication_link}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex text-blue-600 hover:text-blue-800"
                            >
                              <MessageSquareText className="w-4 h-4" />
                            </a>
                          ) : (
                            <MessageSquareText className="w-4 h-4 text-muted-foreground/30 mx-auto" />
                          )}
                        </TableCell>

                        {/* Days */}
                        {activeTab !== 'contract' && (
                          <TableCell className="text-center">
                            {days !== null ? (
                              <Badge
                                variant={getDaysBadgeVariant(days)}
                                className={cn('text-xs', getDaysColor(days))}
                              >
                                {days}d
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </TableCell>
                        )}

                        {/* Remind */}
                        <TableCell>
                          {(() => {
                            const reminds = (row.project_creator_reminds || []).sort((a, b) => b.remind_date.localeCompare(a.remind_date));
                            const latest = reminds[0];
                            return (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openRemind(row.id, creator?.name || '-');
                                }}
                                className={cn(
                                  'text-xs text-left hover:bg-muted rounded px-1 py-0.5 transition-colors',
                                  latest ? '' : 'text-muted-foreground/40 hover:text-muted-foreground'
                                )}
                              >
                                {latest ? (
                                  <>
                                    <span className="font-medium">{latest.remind_date.slice(5)}</span>
                                    {latest.note && <span className="text-muted-foreground ml-1">{latest.note}</span>}
                                    {reminds.length > 1 && <span className="text-muted-foreground ml-1">+{reminds.length - 1}</span>}
                                  </>
                                ) : (
                                  <Bell className="w-3.5 h-3.5" />
                                )}
                              </button>
                            );
                          })()}
                        </TableCell>

                        {/* Review */}
                        <TableCell>
                          {(() => {
                            const reviews = (row.project_creator_reviews || []).filter(rv => rv.status === 'need_review');
                            return (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openReview(row.id, creator?.name || '-');
                                }}
                                className={cn(
                                  'text-xs text-left hover:bg-muted rounded px-1 py-0.5 transition-colors',
                                  reviews.length > 0 ? 'text-red-600' : 'text-muted-foreground/40 hover:text-muted-foreground'
                                )}
                              >
                                {reviews.length > 0 ? (
                                  <>
                                    <AlertCircle className="w-3 h-3 inline mr-1" />
                                    <span>{reviews.length}</span>
                                  </>
                                ) : (
                                  <AlertCircle className="w-3.5 h-3.5" />
                                )}
                              </button>
                            );
                          })()}
                        </TableCell>

                        {/* Memo */}
                        <TableCell className="text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openMemo(row.id, creator?.name || '-');
                            }}
                            className={cn(
                              'inline-flex p-1 rounded hover:bg-muted transition-colors',
                              hasMemos ? 'text-amber-500' : 'text-muted-foreground/40',
                            )}
                          >
                            <StickyNote className="w-4 h-4" />
                          </button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Memo Dialog */}
      <MemoDialog
        open={memoOpen}
        onOpenChange={setMemoOpen}
        projectCreatorId={memoPcId}
        creatorName={memoCreatorName}
        onMemoCountChange={handleMemoCountChange}
      />
      {/* Remind Dialog */}
      <Dialog open={remindOpen} onOpenChange={setRemindOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remind</DialogTitle>
            <DialogDescription>{remindCreatorName}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* History */}
            {(() => {
              const row = allRows.find(r => r.id === remindPcId);
              const reminds = (row?.project_creator_reminds || []).sort((a, b) => b.remind_date.localeCompare(a.remind_date));
              return reminds.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">History</p>
                  <div className="border rounded-lg divide-y max-h-32 overflow-y-auto">
                    {reminds.map(r => (
                      <div key={r.id} className="px-3 py-1.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{r.remind_date}</span>
                          <span className="text-muted-foreground">{r.author_name || '-'}</span>
                        </div>
                        {r.note && <p className="text-muted-foreground mt-0.5">{r.note}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null;
            })()}
            <div className="space-y-2">
              <Label>Date</Label>
              <Input
                type="date"
                value={remindForm.remind_date}
                onChange={(e) => setRemindForm(prev => ({ ...prev, remind_date: e.target.value }))}
                disabled={addingRemind}
              />
            </div>
            <div className="space-y-2">
              <Label>Note</Label>
              <Input
                placeholder="e.g., sign remind sent via email"
                value={remindForm.note}
                onChange={(e) => setRemindForm(prev => ({ ...prev, note: e.target.value }))}
                disabled={addingRemind}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemindOpen(false)} disabled={addingRemind}>Cancel</Button>
            <Button onClick={handleAddRemind} disabled={addingRemind || !remindForm.remind_date}>
              {addingRemind ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Bell className="w-4 h-4 mr-2" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Review Dialog */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Review</DialogTitle>
            <DialogDescription>{reviewCreatorName}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* History */}
            {(() => {
              const row = allRows.find(r => r.id === reviewPcId);
              const reviews = (row?.project_creator_reviews || []).sort((a, b) => b.created_at.localeCompare(a.created_at));
              return reviews.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">History</p>
                  <div className="border rounded-lg divide-y max-h-40 overflow-y-auto">
                    {reviews.map(rv => (
                      <div key={rv.id} className="px-3 py-1.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{rv.review_date}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">{rv.author_name || '-'}</span>
                            {rv.status === 'need_review' ? (
                              <div className="flex gap-1">
                                <button
                                  onClick={() => { setStatusChangeTarget({ reviewId: rv.id, pcId: reviewPcId, newStatus: 'in_progress' }); setStatusChangeNote(''); }}
                                  className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
                                >Request Info</button>
                                <button
                                  onClick={() => { setStatusChangeTarget({ reviewId: rv.id, pcId: reviewPcId, newStatus: 'resolved' }); setStatusChangeNote(''); }}
                                  className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors"
                                >Resolve</button>
                              </div>
                            ) : rv.status === 'in_progress' ? (
                              <div className="flex gap-1">
                                <button
                                  onClick={() => { setStatusChangeTarget({ reviewId: rv.id, pcId: reviewPcId, newStatus: 'resolved' }); setStatusChangeNote(''); }}
                                  className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
                                >Info Requested</button>
                              </div>
                            ) : (
                              <button
                                onClick={() => handleReopenReview(rv.id, reviewPcId)}
                                className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors"
                              >Resolved</button>
                            )}
                          </div>
                        </div>
                        {rv.note && <p className="text-muted-foreground mt-0.5">{rv.note}</p>}
                        {rv.resolve_note && (
                          <p className={cn('mt-0.5', rv.status === 'resolved' ? 'text-emerald-600' : 'text-amber-600')}>
                            {rv.status === 'resolved' ? 'Resolved' : 'Info requested'}: {rv.resolve_note}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null;
            })()}
            <div className="space-y-2">
              <Label>Date</Label>
              <Input
                type="date"
                value={reviewForm.review_date}
                onChange={(e) => setReviewForm(prev => ({ ...prev, review_date: e.target.value }))}
                disabled={addingReview}
              />
            </div>
            <div className="space-y-2">
              <Label>Note <span className="text-destructive">*</span></Label>
              <Input
                placeholder="What needs to be reviewed?"
                value={reviewForm.note}
                onChange={(e) => setReviewForm(prev => ({ ...prev, note: e.target.value }))}
                disabled={addingReview}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)} disabled={addingReview}>Cancel</Button>
            <Button onClick={handleAddReview} disabled={addingReview || !reviewForm.note.trim()}>
              {addingReview ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <AlertCircle className="w-4 h-4 mr-2" />}
              Add Review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Status Change Dialog (Resolve / Request Info) */}
      <Dialog open={!!statusChangeTarget} onOpenChange={(open) => { if (!open) setStatusChangeTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{statusChangeTarget?.newStatus === 'resolved' ? 'Resolve Review' : 'Request More Info'}</DialogTitle>
            <DialogDescription>
              {statusChangeTarget?.newStatus === 'resolved'
                ? 'What was done to resolve this?'
                : 'What additional information do you need?'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>{statusChangeTarget?.newStatus === 'resolved' ? 'Resolution Note' : 'Request Note'}</Label>
              <Input
                placeholder={statusChangeTarget?.newStatus === 'resolved' ? 'e.g., sent new contract, issue fixed...' : 'e.g., need shipping address, need confirmation...'}
                value={statusChangeNote}
                onChange={(e) => setStatusChangeNote(e.target.value)}
                disabled={changingStatus}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleStatusChange(); }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusChangeTarget(null)} disabled={changingStatus}>Cancel</Button>
            <Button onClick={handleStatusChange} disabled={changingStatus}>
              {changingStatus ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
              {statusChangeTarget?.newStatus === 'resolved' ? 'Resolve' : 'Request Info'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  );
}
