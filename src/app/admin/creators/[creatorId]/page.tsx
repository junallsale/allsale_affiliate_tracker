'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, ExternalLink, Loader2, History, FolderOpen, Plus, Check, Pencil,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { createSupabaseBrowser } from '@/lib/supabase-browser';

interface CreatorMaster {
  id: string; handle: string; email: string | null; payment_email: string | null;
  category: string | null; gender: string | null; tier: number | null;
  gmv: number | null; avg_view: number | null; followers: number | null;
  price_per_video: number | null; price_comment: string | null;
  total_projects: number; total_contracts: number;
  total_videos_assigned: number; total_videos_uploaded: number;
  last_assigned_at: string | null; created_at: string; updated_at: string;
}

interface PricingHistory {
  id: string; recorded_at: string; gmv: number | null; avg_view: number | null;
  followers: number | null; price_per_video: number | null; price_comment: string | null; tier: number | null; source: string | null;
}

interface ProjectAssignment {
  pc_id: string; project_id: string; project_name: string;
  brand_name: string; brand_slug: string; contract_amount: number;
  signed_at: string | null; videos_count: number; assigned_video_count: number;
}

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const tierLabel = (t: number | null) => {
  if (t === 1) return { text: 'Tier 1 (Good Deal)', color: 'bg-emerald-100 text-emerald-700' };
  if (t === 2) return { text: 'Tier 2 (Fair)', color: 'bg-amber-100 text-amber-700' };
  if (t === 3) return { text: 'Tier 3 (Expensive)', color: 'bg-red-100 text-red-700' };
  return { text: 'N/A', color: 'bg-muted text-muted-foreground' };
};

export default function CreatorDetailPage() {
  const params = useParams();
  const router = useRouter();
  const creatorId = params.creatorId as string;
  const supabase = useMemo(() => createSupabaseBrowser(), []);

  const [loading, setLoading] = useState(true);
  const [creator, setCreator] = useState<CreatorMaster | null>(null);
  const [history, setHistory] = useState<PricingHistory[]>([]);
  const [projects, setProjects] = useState<ProjectAssignment[]>([]);

  const [historyForm, setHistoryForm] = useState({ date: new Date().toISOString().split('T')[0], gmv: '', avg_view: '', price_per_video: '', price_comment: '' });
  const [addingHistory, setAddingHistory] = useState(false);

  const [assignOpen, setAssignOpen] = useState(false);
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [allProjects, setAllProjects] = useState<{ id: string; name: string; brand_id: string }[]>([]);
  const [assignBrandId, setAssignBrandId] = useState('');
  const [assignProjectId, setAssignProjectId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignResult, setAssignResult] = useState<string | null>(null);

  // Edit creator info (handle / email / payment_email)
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ handle: '', email: '', payment_email: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data: cm } = await supabase.from('creator_master').select('*').eq('id', creatorId).single();
    if (cm) setCreator(cm as CreatorMaster);

    if (cm) {
      const { data: hist } = await supabase.from('creator_pricing_history').select('*')
        .eq('creator_master_id', cm.id).order('recorded_at', { ascending: false });
      setHistory((hist || []) as PricingHistory[]);

      const { data: pcData } = await supabase
        .from('project_creators')
        .select('id, contract_amount, signed_at, assigned_video_count, projects(id, name, brands(name, slug)), videos(id), creators!inner(tiktok_handle)')
        .eq('creators.tiktok_handle', cm.handle);
      setProjects((pcData || []).map((pc: any) => ({
        pc_id: pc.id, project_id: pc.projects?.id || '', project_name: pc.projects?.name || '-',
        brand_name: pc.projects?.brands?.name || '-', brand_slug: pc.projects?.brands?.slug || '',
        contract_amount: pc.contract_amount || 0, signed_at: pc.signed_at,
        videos_count: (pc.videos || []).length, assigned_video_count: pc.assigned_video_count || 0,
      })));
    }

    const { data: b } = await supabase.from('brands').select('id, name').order('name');
    setBrands((b || []) as any[]);
    const { data: p } = await supabase.from('projects').select('id, name, brand_id').order('name');
    setAllProjects((p || []) as any[]);
    setLoading(false);
  }, [creatorId, supabase]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAddHistory = async () => {
    if (!creator) return;
    setAddingHistory(true);
    try {
      await supabase.from('creator_pricing_history').upsert({
        creator_master_id: creator.id, recorded_at: historyForm.date,
        gmv: historyForm.gmv ? parseFloat(historyForm.gmv) : null,
        avg_view: historyForm.avg_view ? parseFloat(historyForm.avg_view) : null,
        price_per_video: historyForm.price_per_video ? parseFloat(historyForm.price_per_video) : null,
        price_comment: historyForm.price_comment || null,
        source: 'manual',
      }, { onConflict: 'creator_master_id,recorded_at' });

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (historyForm.gmv) updates.gmv = parseFloat(historyForm.gmv);
      if (historyForm.avg_view) updates.avg_view = parseFloat(historyForm.avg_view);
      if (historyForm.price_per_video) updates.price_per_video = parseFloat(historyForm.price_per_video);
      if (historyForm.price_comment) updates.price_comment = historyForm.price_comment;
      await supabase.from('creator_master').update(updates).eq('id', creator.id);

      setHistoryForm({ date: new Date().toISOString().split('T')[0], gmv: '', avg_view: '', price_per_video: '', price_comment: '' });
      await fetchData();
    } catch (err) { console.error(err); }
    finally { setAddingHistory(false); }
  };

  const openEdit = () => {
    if (!creator) return;
    setEditForm({
      handle: creator.handle || '',
      email: creator.email || '',
      payment_email: creator.payment_email || '',
    });
    setEditError(null);
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!creator) return;
    const cleanHandle = editForm.handle.trim().toLowerCase().replace(/^@+/, '');
    if (!cleanHandle) { setEditError('Handle is required'); return; }
    setSavingEdit(true);
    setEditError(null);
    try {
      const { error } = await supabase
        .from('creator_master')
        .update({
          handle: cleanHandle,
          email: editForm.email.trim() || null,
          payment_email: editForm.payment_email.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', creator.id);
      if (error) {
        setEditError(error.code === '23505' ? 'Another creator already uses this handle' : error.message);
        return;
      }
      setEditOpen(false);
      await fetchData();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleAssign = async () => {
    if (!creator || !assignBrandId || !assignProjectId) return;
    setAssigning(true); setAssignResult(null);
    try {
      const res = await fetch('/api/affiliates/auto-assign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handles: [creator.handle], brand_id: assignBrandId, project_id: assignProjectId, status: 'Rate Received' }),
      });
      const data = await res.json();
      if (data.assigned > 0) { setAssignResult('Assigned successfully'); await fetchData(); }
      else if (data.skipped_duplicate > 0) setAssignResult('Already assigned to this brand');
      else setAssignResult(data.error || 'Failed');
    } catch { setAssignResult('Error'); }
    finally { setAssigning(false); }
  };

  if (loading || !creator) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  }

  const tier = tierLabel(creator.tier);
  const filteredProjects = allProjects.filter(p => p.brand_id === assignBrandId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/creators"><ArrowLeft className="w-4 h-4" /></Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">@{creator.handle}</h1>
            <a href={`https://www.tiktok.com/@${creator.handle}`} target="_blank" rel="noopener noreferrer"
              className="text-blue-600 hover:underline flex items-center gap-1 text-sm">TikTok <ExternalLink className="w-3 h-3" /></a>
            <span className={cn('px-2 py-0.5 rounded text-xs font-medium', tier.color)}>{tier.text}</span>
          </div>
          <div className="text-sm text-muted-foreground mt-1 flex gap-4">
            {creator.email && <span>Email: {creator.email}</span>}
            {creator.payment_email && <span>PayPal: {creator.payment_email}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={openEdit}>
            <Pencil className="w-4 h-4 mr-2" /> Edit Info
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setAssignOpen(true); setAssignResult(null); }}>
            <Plus className="w-4 h-4 mr-2" /> Assign to Project
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: 'GMV', value: creator.gmv ? `$${Math.round(Number(creator.gmv)).toLocaleString()}` : '-' },
          { label: 'Avg View', value: creator.avg_view ? Math.round(Number(creator.avg_view)).toLocaleString() : '-' },
          { label: 'Followers', value: creator.followers ? Math.round(Number(creator.followers)).toLocaleString() : '-' },
          { label: 'Price/Video', value: creator.price_per_video ? `$${Math.round(Number(creator.price_per_video))}` : '-' },
          { label: 'Projects', value: String(creator.total_projects) },
          { label: 'Total Contract', value: creator.total_contracts ? formatCurrency(Number(creator.total_contracts)) : '-' },
        ].map(s => (
          <Card key={s.label}><CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="text-xl font-bold">{s.value}</p>
          </CardContent></Card>
        ))}
      </div>

      {/* Info */}
      {(creator.price_comment || creator.category || creator.gender) && (
        <Card><CardContent className="pt-4 pb-3">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div><p className="text-xs text-muted-foreground mb-1">Category</p><p>{creator.category || '-'}</p></div>
            <div><p className="text-xs text-muted-foreground mb-1">Gender</p><p>{creator.gender || '-'}</p></div>
            <div><p className="text-xs text-muted-foreground mb-1">Price Comment</p><p className="text-xs">{creator.price_comment || '-'}</p></div>
          </div>
        </CardContent></Card>
      )}

      {/* Project Assignments */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><FolderOpen className="w-4 h-4" /> Project Assignments ({projects.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No project assignments</p>
          ) : (
            <Table><TableHeader><TableRow>
              <TableHead>Brand / Project</TableHead><TableHead className="text-right">Contract</TableHead>
              <TableHead className="text-center">Videos</TableHead><TableHead>Signed</TableHead>
            </TableRow></TableHeader><TableBody>
              {projects.map(p => (
                <TableRow key={p.pc_id} className="cursor-pointer hover:bg-muted/50"
                  onClick={() => router.push(`/admin/brands/${p.brand_slug}/projects/${p.project_id}/creators/${p.pc_id}`)}>
                  <TableCell><p className="font-medium text-sm">{p.brand_name}</p><p className="text-xs text-muted-foreground">{p.project_name}</p></TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(p.contract_amount)}</TableCell>
                  <TableCell className="text-center text-sm">{p.videos_count}/{p.assigned_video_count}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.signed_at ? new Date(p.signed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Not signed'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody></Table>
          )}
        </CardContent>
      </Card>

      {/* Pricing History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><History className="w-4 h-4" /> Pricing History ({history.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {history.length > 0 && (
            <Table><TableHeader><TableRow>
              <TableHead>Date</TableHead><TableHead>GMV</TableHead><TableHead>Avg View</TableHead>
              <TableHead>Price</TableHead><TableHead>Price Comment</TableHead><TableHead>Tier</TableHead><TableHead>Source</TableHead>
            </TableRow></TableHeader><TableBody>
              {history.map(h => (
                <TableRow key={h.id}>
                  <TableCell className="text-sm">{h.recorded_at}</TableCell>
                  <TableCell className="text-sm">{h.gmv ? `$${Math.round(Number(h.gmv)).toLocaleString()}` : '-'}</TableCell>
                  <TableCell className="text-sm">{h.avg_view ? Math.round(Number(h.avg_view)).toLocaleString() : '-'}</TableCell>
                  <TableCell className="text-sm font-medium">{h.price_per_video ? `$${Math.round(Number(h.price_per_video))}` : '-'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[200px]">{h.price_comment || '-'}</TableCell>
                  <TableCell className="text-sm">{h.tier || '-'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{h.source || '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody></Table>
          )}
          <Separator />
          <div className="flex flex-wrap gap-2 items-end">
            <div className="space-y-1"><Label className="text-xs">Date</Label>
              <Input type="date" className="h-8 text-xs w-[150px]" value={historyForm.date} onChange={(e) => setHistoryForm(p => ({ ...p, date: e.target.value }))} /></div>
            <div className="space-y-1"><Label className="text-xs">GMV</Label>
              <Input type="number" className="h-8 text-xs w-[100px]" placeholder="$" value={historyForm.gmv} onChange={(e) => setHistoryForm(p => ({ ...p, gmv: e.target.value }))} /></div>
            <div className="space-y-1"><Label className="text-xs">Avg View</Label>
              <Input type="number" className="h-8 text-xs w-[100px]" value={historyForm.avg_view} onChange={(e) => setHistoryForm(p => ({ ...p, avg_view: e.target.value }))} /></div>
            <div className="space-y-1"><Label className="text-xs">Price/Video</Label>
              <Input type="number" className="h-8 text-xs w-[100px]" placeholder="$" value={historyForm.price_per_video} onChange={(e) => setHistoryForm(p => ({ ...p, price_per_video: e.target.value }))} /></div>
            <div className="space-y-1"><Label className="text-xs">Price Comment</Label>
              <Input type="text" className="h-8 text-xs w-[180px]" placeholder="e.g. negotiated, bundle" value={historyForm.price_comment} onChange={(e) => setHistoryForm(p => ({ ...p, price_comment: e.target.value }))} /></div>
            <Button size="sm" className="h-8" onClick={handleAddHistory} disabled={addingHistory}>
              {addingHistory ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Edit Info Dialog */}
      <Dialog open={editOpen} onOpenChange={(open) => { if (!savingEdit) { setEditOpen(open); if (!open) setEditError(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Creator Info</DialogTitle>
            <DialogDescription>Update the handle and email addresses.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Handle <span className="text-red-500">*</span></Label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">@</span>
                <Input
                  autoFocus
                  className="pl-6"
                  placeholder="username"
                  value={editForm.handle}
                  onChange={(e) => setEditForm(f => ({ ...f, handle: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !savingEdit) handleSaveEdit(); }}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                placeholder="creator@email.com"
                value={editForm.email}
                onChange={(e) => setEditForm(f => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>PayPal / Payment Email</Label>
              <Input
                type="email"
                placeholder="paypal@email.com"
                value={editForm.payment_email}
                onChange={(e) => setEditForm(f => ({ ...f, payment_email: e.target.value }))}
              />
            </div>
            {editError && <p className="text-sm text-red-600">{editError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={savingEdit}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={savingEdit || !editForm.handle.trim()}>
              {savingEdit ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign to Project</DialogTitle>
            <DialogDescription>@{creator.handle} → affiliate with status "Rate Received"</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Brand</Label>
              <select className="flex h-10 w-full rounded-md border px-3 py-2 text-sm bg-background"
                value={assignBrandId} onChange={(e) => { setAssignBrandId(e.target.value); setAssignProjectId(''); }}>
                <option value="">Select brand...</option>
                {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></div>
            <div className="space-y-2"><Label>Project</Label>
              <select className="flex h-10 w-full rounded-md border px-3 py-2 text-sm bg-background"
                value={assignProjectId} onChange={(e) => setAssignProjectId(e.target.value)} disabled={!assignBrandId}>
                <option value="">{assignBrandId ? 'Select project...' : 'Select brand first'}</option>
                {filteredProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></div>
            {assignResult && <p className={cn('text-sm', assignResult.includes('success') ? 'text-emerald-600' : 'text-amber-600')}>{assignResult}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button onClick={handleAssign} disabled={assigning || !assignBrandId || !assignProjectId}>
              {assigning ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />} Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
