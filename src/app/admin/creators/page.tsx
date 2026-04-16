'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import {
  Users, Search, ExternalLink, Download, History, FolderOpen,
  ChevronDown, ChevronUp, Loader2, Plus, Check,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface CreatorMaster {
  id: string;
  handle: string;
  email: string | null;
  category: string | null;
  gender: string | null;
  language: string | null;
  race: string | null;
  consistency: string | null;
  tier: number | null;
  gmv: number | null;
  avg_view: number | null;
  followers: number | null;
  price_per_video: number | null;
  price_comment: string | null;
  total_projects: number;
  total_contracts: number;
  total_videos_assigned: number;
  total_videos_uploaded: number;
  last_assigned_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PricingHistory {
  id: string;
  recorded_at: string;
  gmv: number | null;
  avg_view: number | null;
  followers: number | null;
  price_per_video: number | null;
  tier: number | null;
  source: string | null;
}

const CATEGORY_OPTIONS = ['hair', 'skincare', 'makeup', 'health', 'lifestyle', 'fashion', 'food'];
const CONSISTENCY_OPTIONS = [
  { value: 'consistent', label: 'Consistent', color: 'bg-emerald-100 text-emerald-700' },
  { value: 'mixed', label: 'Mixed', color: 'bg-amber-100 text-amber-700' },
  { value: 'lifestyle', label: 'Lifestyle', color: 'bg-purple-100 text-purple-700' },
];

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const tierLabel = (t: number | null) => {
  if (t === 1) return { text: 'Good', color: 'bg-emerald-100 text-emerald-700' };
  if (t === 2) return { text: 'Fair', color: 'bg-amber-100 text-amber-700' };
  if (t === 3) return { text: 'High', color: 'bg-red-100 text-red-700' };
  return { text: '-', color: 'bg-muted text-muted-foreground' };
};

function CategoryChips({ category }: { category: string | null }) {
  if (!category) return <span className="text-muted-foreground text-sm">-</span>;
  const cats = category.split(',').map(c => c.trim()).filter(Boolean);
  return (
    <div className="flex flex-wrap gap-1">
      {cats.map(cat => (
        <span key={cat} className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">{cat}</span>
      ))}
    </div>
  );
}

function CategoryMultiSelect({
  value, top, left, onSave, onClose,
}: {
  value: string; top: number; left: number;
  onSave: (value: string) => void; onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set((value || '').split(',').map(s => s.trim()).filter(Boolean))
  );
  const toggle = (opt: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(opt)) next.delete(opt); else next.add(opt);
    return next;
  });
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-white border rounded-lg shadow-lg p-2 min-w-[160px]"
        style={{
          left,
          ...(top + 300 > window.innerHeight
            ? { bottom: window.innerHeight - top + 4 }
            : { top }),
        }}
      >
        {CATEGORY_OPTIONS.map(opt => (
          <label key={opt} className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-muted/60 rounded text-sm select-none">
            <input type="checkbox" checked={selected.has(opt)} onChange={() => toggle(opt)} className="w-3.5 h-3.5" />
            {opt}
          </label>
        ))}
        <div className="flex gap-1 mt-2 pt-2 border-t">
          <button
            onClick={() => onSave([...selected].join(', '))}
            className="flex-1 text-sm bg-primary text-primary-foreground rounded px-2 py-1.5 font-medium"
          >Save</button>
          <button onClick={onClose} className="flex-1 text-sm border rounded px-2 py-1.5">Cancel</button>
        </div>
      </div>
    </>
  );
}

export default function CreatorsPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowser(), []);
  const [creators, setCreators] = useState<CreatorMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [sortField, setSortField] = useState<string>('updated_at');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  // Inline editing
  const [inlineEdit, setInlineEdit] = useState<{ id: string; handle: string; field: 'tier' | 'category' | 'gender' | 'language' | 'race' | 'consistency'; value: string; rect?: { top: number; left: number } } | null>(null);

  // History dialog
  const [historyTarget, setHistoryTarget] = useState<CreatorMaster | null>(null);
  const [history, setHistory] = useState<PricingHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [projectHistory, setProjectHistory] = useState<{ project_name: string; brand_name: string; contract_amount: number; signed_at: string | null; videos_count: number }[]>([]);

  // Assign dialog
  const [assignTarget, setAssignTarget] = useState<CreatorMaster | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [allProjectsList, setAllProjectsList] = useState<{ id: string; name: string; brand_id: string }[]>([]);
  const [assignBrandId, setAssignBrandId] = useState('');
  const [assignProjectId, setAssignProjectId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignResult, setAssignResult] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      const { data } = await supabase
        .from('creator_master')
        .select('*')
        .order('gmv', { ascending: false, nullsFirst: false });
      if (data) setCreators(data as CreatorMaster[]);
      const { data: b } = await supabase.from('brands').select('id, name').order('name');
      if (b) setBrands(b as any[]);
      const { data: p } = await supabase.from('projects').select('id, name, brand_id').order('name');
      if (p) setAllProjectsList(p as any[]);
      setLoading(false);
    }
    fetchData();
  }, [supabase]);

  // Pass the value directly to avoid stale closure issues
  const saveInlineField = useCallback(async (id: string, handle: string, field: 'tier' | 'category' | 'gender' | 'language' | 'race' | 'consistency', rawValue: string) => {
    const updates: Record<string, unknown> = {};
    if (field === 'tier') {
      updates.tier = rawValue ? parseInt(rawValue) : null;
    } else if (field === 'gender') {
      updates.gender = rawValue.trim() || null;
    } else if (field === 'language') {
      updates.language = rawValue.trim() || null;
    } else if (field === 'race') {
      updates.race = rawValue.trim() || null;
    } else if (field === 'consistency') {
      updates.consistency = rawValue.trim() || null;
    } else {
      updates.category = rawValue.trim() || null;
    }
    setInlineEdit(null);
    const res = await fetch('/api/creators/master', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle, ...updates }),
    });
    if (res.ok) {
      setCreators(prev => prev.map(c => c.id === id ? { ...c, ...updates } as CreatorMaster : c));
    }
  }, []);

  const openHistory = useCallback(async (creator: CreatorMaster) => {
    setHistoryTarget(creator);
    setLoadingHistory(true);
    const { data: histData } = await supabase
      .from('creator_pricing_history')
      .select('*')
      .eq('creator_master_id', creator.id)
      .order('recorded_at', { ascending: false });
    setHistory((histData || []) as PricingHistory[]);

    const { data: pcData } = await supabase
      .from('project_creators')
      .select('contract_amount, signed_at, assigned_video_count, projects(name, brands(name)), videos(id), creators!inner(tiktok_handle)')
      .eq('creators.tiktok_handle', creator.handle);
    const projects = (pcData || []).map((pc: any) => ({
      project_name: pc.projects?.name || '-',
      brand_name: pc.projects?.brands?.name || '-',
      contract_amount: pc.contract_amount || 0,
      signed_at: pc.signed_at,
      videos_count: (pc.videos || []).length,
    }));
    setProjectHistory(projects);
    setLoadingHistory(false);
  }, [supabase]);

  const filtered = useMemo(() => {
    let result = [...creators];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(c =>
        c.handle.includes(q) || (c.email || '').toLowerCase().includes(q) || (c.category || '').toLowerCase().includes(q)
      );
    }
    if (tierFilter) result = result.filter(c => String(c.tier) === tierFilter);
    if (categoryFilter) {
      result = result.filter(c =>
        (c.category || '').split(',').map(s => s.trim().toLowerCase()).includes(categoryFilter.toLowerCase())
      );
    }
    result.sort((a, b) => {
      const aRaw = (a as any)[sortField];
      const bRaw = (b as any)[sortField];
      if (sortField === 'handle' || sortField === 'category' || sortField === 'gender' || sortField === 'language' || sortField === 'race' || sortField === 'consistency' || sortField === 'updated_at') {
        const aStr = (aRaw || '').toString();
        const bStr = (bRaw || '').toString();
        return sortAsc ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
      }
      const aVal = Number(aRaw) || 0;
      const bVal = Number(bRaw) || 0;
      return sortAsc ? aVal - bVal : bVal - aVal;
    });
    return result;
  }, [creators, search, tierFilter, categoryFilter, sortField, sortAsc]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    creators.forEach(c => {
      if (c.category) {
        c.category.split(',').forEach(cat => {
          const t = cat.trim();
          if (t) set.add(t);
        });
      }
    });
    return [...set].sort();
  }, [creators]);

  const totalWithPrice = creators.filter(c => c.price_per_video && c.price_per_video > 0).length;
  const totalWithProjects = creators.filter(c => c.total_projects > 0).length;

  const handleSort = (field: string) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(false); }
    setPage(0);
  };

  const SortIcon = ({ field }: { field: string }) => (
    sortField === field ? (sortAsc ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />) : null
  );

  const handleDownloadCsv = () => {
    const header = 'Handle,GMV,Avg View,Followers,Price/Video,Tier,Category,Gender,Language,Race,Consistency,Projects,Total Contract,Videos Assigned,Videos Uploaded';
    const rows = filtered.map(c => [
      c.handle, Math.round(Number(c.gmv) || 0), Math.round(Number(c.avg_view) || 0),
      Math.round(Number(c.followers) || 0), Math.round(Number(c.price_per_video) || 0),
      c.tier || '', c.category || '', c.gender || '', c.language || '', c.race || '', c.consistency || '',
      c.total_projects, Math.round(Number(c.total_contracts) || 0),
      c.total_videos_assigned, c.total_videos_uploaded,
    ].join(','));
    const csv = header + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `creator-master-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click(); URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6" /> Creator Database
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {creators.length} creators · {totalWithPrice} with pricing · {totalWithProjects} assigned to projects
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleDownloadCsv}>
          <Download className="w-4 h-4 mr-2" /> CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search handle, email..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="h-8 w-56 pl-8 text-sm"
          />
        </div>
        <select
          value={tierFilter}
          onChange={(e) => { setTierFilter(e.target.value); setPage(0); }}
          className="h-8 rounded-md border px-2 text-sm bg-background"
        >
          <option value="">All Tiers</option>
          <option value="1">Tier 1 (Good)</option>
          <option value="2">Tier 2 (Fair)</option>
          <option value="3">Tier 3 (High)</option>
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => { setCategoryFilter(e.target.value); setPage(0); }}
          className="h-8 rounded-md border px-2 text-sm bg-background"
        >
          <option value="">All Categories</option>
          {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">{filtered.length} results</span>
        <span className="text-xs text-muted-foreground italic">Click Tier, Category, or Gender cell to edit inline</span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[calc(100vh-280px)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-10 bg-muted/80 backdrop-blur-sm min-w-[160px] cursor-pointer" onClick={() => handleSort('handle')}>Handle <SortIcon field="handle" /></TableHead>
                  <TableHead className="cursor-pointer" onClick={() => handleSort('gmv')}>GMV <SortIcon field="gmv" /></TableHead>
                  <TableHead className="cursor-pointer" onClick={() => handleSort('avg_view')}>Avg View <SortIcon field="avg_view" /></TableHead>
                  <TableHead className="cursor-pointer" onClick={() => handleSort('price_per_video')}>Price/Video <SortIcon field="price_per_video" /></TableHead>
                  <TableHead className="cursor-pointer" onClick={() => handleSort('tier')}>Tier <SortIcon field="tier" /></TableHead>
                  <TableHead className="cursor-pointer min-w-[140px]" onClick={() => handleSort('category')}>Category <SortIcon field="category" /></TableHead>
                  <TableHead className="cursor-pointer" onClick={() => handleSort('gender')}>Gender <SortIcon field="gender" /></TableHead>
                  <TableHead className="cursor-pointer" onClick={() => handleSort('language')}>Language <SortIcon field="language" /></TableHead>
                  <TableHead className="cursor-pointer" onClick={() => handleSort('race')}>Race <SortIcon field="race" /></TableHead>
                  <TableHead className="cursor-pointer" onClick={() => handleSort('consistency')}>Consistency <SortIcon field="consistency" /></TableHead>
                  <TableHead className="cursor-pointer" onClick={() => handleSort('total_projects')}>Projects <SortIcon field="total_projects" /></TableHead>
                  <TableHead className="cursor-pointer" onClick={() => handleSort('total_contracts')}>Contract <SortIcon field="total_contracts" /></TableHead>
                  <TableHead className="cursor-pointer" onClick={() => handleSort('followers')}>Followers <SortIcon field="followers" /></TableHead>
                  <TableHead className="cursor-pointer" onClick={() => handleSort('updated_at')}>Updated <SortIcon field="updated_at" /></TableHead>
                  <TableHead className="text-center">History</TableHead>
                  <TableHead className="text-center">Assign</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={14} className="text-center py-8 text-muted-foreground">No creators found</TableCell>
                  </TableRow>
                ) : (
                  filtered.slice(page * pageSize, (page + 1) * pageSize).map(c => {
                    const tier = tierLabel(c.tier);
                    const isEditingTier = inlineEdit?.id === c.id && inlineEdit.field === 'tier';
                    const isEditingCategory = inlineEdit?.id === c.id && inlineEdit.field === 'category';
                    return (
                      <TableRow
                        key={c.id}
                        className="hover:bg-muted/50 cursor-pointer"
                        onClick={() => router.push(`/admin/creators/${c.id}`)}
                      >
                        {/* Handle */}
                        <TableCell className="sticky left-0 z-10 bg-background">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); router.push(`/admin/creators/${c.id}`); }}
                              className="text-sm font-mono text-blue-600 hover:underline cursor-pointer"
                            >
                              @{c.handle}
                            </button>
                            <a
                              href={`https://www.tiktok.com/@${c.handle}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-muted-foreground hover:text-blue-600"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        </TableCell>

                        {/* GMV */}
                        <TableCell className="text-sm">{c.gmv ? `$${Math.round(Number(c.gmv)).toLocaleString()}` : '-'}</TableCell>

                        {/* Avg View */}
                        <TableCell className="text-sm">{c.avg_view ? Math.round(Number(c.avg_view)).toLocaleString() : '-'}</TableCell>

                        {/* Price/Video */}
                        <TableCell className="text-sm font-medium">{c.price_per_video ? `$${Math.round(Number(c.price_per_video))}` : '-'}</TableCell>

                        {/* Tier — inline editable */}
                        <TableCell
                          onClick={(e) => {
                            e.stopPropagation();
                            setInlineEdit({ id: c.id, handle: c.handle, field: 'tier', value: c.tier ? String(c.tier) : '' });
                          }}
                          className="min-w-[80px]"
                          title="Click to edit tier"
                        >
                          {isEditingTier ? (
                            <select
                              autoFocus
                              defaultValue={c.tier ? String(c.tier) : ''}
                              onChange={(e) => saveInlineField(c.id, c.handle, 'tier', e.target.value)}
                              onBlur={() => setInlineEdit(null)}
                              onClick={(e) => e.stopPropagation()}
                              className="border rounded px-1 text-sm w-24"
                            >
                              <option value="">-</option>
                              <option value="1">1 Good</option>
                              <option value="2">2 Fair</option>
                              <option value="3">3 High</option>
                            </select>
                          ) : (
                            <span className={cn('px-2 py-0.5 rounded text-xs font-medium cursor-pointer hover:opacity-70', tier.color)}>
                              {tier.text}
                            </span>
                          )}
                        </TableCell>

                        {/* Category — multi-select popup */}
                        <TableCell
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            setInlineEdit({ id: c.id, handle: c.handle, field: 'category', value: c.category || '', rect: { top: rect.bottom + 4, left: rect.left } });
                          }}
                          className="min-w-[120px]"
                          title="Click to edit category"
                        >
                          <div className="cursor-pointer hover:opacity-70">
                            <CategoryChips category={c.category} />
                          </div>
                        </TableCell>

                        {/* Gender — inline editable */}
                        <TableCell
                          onClick={(e) => {
                            e.stopPropagation();
                            setInlineEdit({ id: c.id, handle: c.handle, field: 'gender', value: c.gender || '' });
                          }}
                          className="min-w-[80px]"
                          title="Click to edit gender"
                        >
                          {inlineEdit?.id === c.id && inlineEdit.field === 'gender' ? (
                            <select
                              autoFocus
                              defaultValue={c.gender || ''}
                              onChange={(e) => saveInlineField(c.id, c.handle, 'gender', e.target.value)}
                              onBlur={() => setInlineEdit(null)}
                              onClick={(e) => e.stopPropagation()}
                              className="border rounded px-1 text-sm w-24"
                            >
                              <option value="">-</option>
                              <option value="male">Male</option>
                              <option value="female">Female</option>
                            </select>
                          ) : (
                            <span className={cn(
                              'px-2 py-0.5 rounded text-xs font-medium cursor-pointer hover:opacity-70',
                              c.gender === 'male' ? 'bg-blue-100 text-blue-700' :
                              c.gender === 'female' ? 'bg-pink-100 text-pink-700' :
                              'bg-muted text-muted-foreground'
                            )}>
                              {c.gender ? c.gender.charAt(0).toUpperCase() + c.gender.slice(1) : '-'}
                            </span>
                          )}
                        </TableCell>

                        {/* Language — inline editable */}
                        <TableCell
                          onClick={(e) => {
                            e.stopPropagation();
                            setInlineEdit({ id: c.id, handle: c.handle, field: 'language', value: c.language || '' });
                          }}
                          className="min-w-[80px]"
                          title="Click to edit language"
                        >
                          {inlineEdit?.id === c.id && inlineEdit.field === 'language' ? (
                            <select
                              autoFocus
                              defaultValue={c.language || ''}
                              onChange={(e) => saveInlineField(c.id, c.handle, 'language', e.target.value)}
                              onBlur={() => setInlineEdit(null)}
                              onClick={(e) => e.stopPropagation()}
                              className="border rounded px-1 text-sm w-24"
                            >
                              <option value="">-</option>
                              <option value="English">English</option>
                              <option value="Spanish">Spanish</option>
                              <option value="Other">Other</option>
                            </select>
                          ) : (
                            <span className={cn(
                              'px-2 py-0.5 rounded text-xs font-medium cursor-pointer hover:opacity-70',
                              c.language === 'English' ? 'bg-indigo-100 text-indigo-700' :
                              c.language === 'Spanish' ? 'bg-amber-100 text-amber-700' :
                              c.language ? 'bg-muted text-muted-foreground' :
                              'bg-muted text-muted-foreground'
                            )}>
                              {c.language || '-'}
                            </span>
                          )}
                        </TableCell>

                        {/* Race — inline editable */}
                        <TableCell
                          onClick={(e) => {
                            e.stopPropagation();
                            setInlineEdit({ id: c.id, handle: c.handle, field: 'race', value: c.race || '' });
                          }}
                          className="min-w-[80px]"
                          title="Click to edit race"
                        >
                          {inlineEdit?.id === c.id && inlineEdit.field === 'race' ? (
                            <select
                              autoFocus
                              defaultValue={c.race || ''}
                              onChange={(e) => saveInlineField(c.id, c.handle, 'race', e.target.value)}
                              onBlur={() => setInlineEdit(null)}
                              onClick={(e) => e.stopPropagation()}
                              className="border rounded px-1 text-sm w-24"
                            >
                              <option value="">-</option>
                              <option value="White">White</option>
                              <option value="Black">Black</option>
                              <option value="Hispanic">Hispanic</option>
                              <option value="Asian">Asian</option>
                              <option value="Other">Other</option>
                            </select>
                          ) : (
                            <span className={cn(
                              'px-2 py-0.5 rounded text-xs font-medium cursor-pointer hover:opacity-70',
                              c.race === 'White' ? 'bg-slate-100 text-slate-700' :
                              c.race === 'Black' ? 'bg-violet-100 text-violet-700' :
                              c.race === 'Hispanic' ? 'bg-orange-100 text-orange-700' :
                              c.race === 'Asian' ? 'bg-teal-100 text-teal-700' :
                              c.race ? 'bg-muted text-muted-foreground' :
                              'bg-muted text-muted-foreground'
                            )}>
                              {c.race || '-'}
                            </span>
                          )}
                        </TableCell>

                        {/* Consistency — inline editable */}
                        <TableCell
                          onClick={(e) => {
                            e.stopPropagation();
                            setInlineEdit({ id: c.id, handle: c.handle, field: 'consistency', value: c.consistency || '' });
                          }}
                          className="min-w-[90px]"
                          title="Click to edit consistency"
                        >
                          {inlineEdit?.id === c.id && inlineEdit.field === 'consistency' ? (
                            <select
                              autoFocus
                              defaultValue={c.consistency || ''}
                              onChange={(e) => saveInlineField(c.id, c.handle, 'consistency', e.target.value)}
                              onBlur={() => setInlineEdit(null)}
                              onClick={(e) => e.stopPropagation()}
                              className="border rounded px-1 text-sm w-28"
                            >
                              <option value="">-</option>
                              {CONSISTENCY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          ) : (
                            <span className={cn(
                              'px-2 py-0.5 rounded text-xs font-medium cursor-pointer hover:opacity-70',
                              CONSISTENCY_OPTIONS.find(o => o.value === c.consistency)?.color || 'bg-muted text-muted-foreground'
                            )}>
                              {CONSISTENCY_OPTIONS.find(o => o.value === c.consistency)?.label || '-'}
                            </span>
                          )}
                        </TableCell>

                        {/* Projects */}
                        <TableCell>
                          {c.total_projects > 0 ? (
                            <Badge variant="secondary" className="text-xs">{c.total_projects}</Badge>
                          ) : '-'}
                        </TableCell>

                        {/* Contract */}
                        <TableCell className="text-sm">{c.total_contracts ? formatCurrency(Number(c.total_contracts)) : '-'}</TableCell>

                        {/* Followers */}
                        <TableCell className="text-sm">{c.followers ? Math.round(Number(c.followers)).toLocaleString() : '-'}</TableCell>

                        {/* Updated */}
                        <TableCell className="text-xs text-muted-foreground">
                          {c.updated_at ? new Date(c.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'}
                        </TableCell>

                        {/* History */}
                        <TableCell className="text-center">
                          <button
                            onClick={(e) => { e.stopPropagation(); openHistory(c); }}
                            className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                          >
                            <History className="w-4 h-4" />
                          </button>
                        </TableCell>

                        {/* Assign */}
                        <TableCell className="text-center">
                          <button
                            onClick={(e) => { e.stopPropagation(); setAssignTarget(c); setAssignOpen(true); setAssignResult(null); }}
                            className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
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

      {/* Category multi-select popup */}
      {inlineEdit?.field === 'category' && inlineEdit.rect && (
        <CategoryMultiSelect
          value={inlineEdit.value}
          top={inlineEdit.rect.top}
          left={inlineEdit.rect.left}
          onSave={(value) => saveInlineField(inlineEdit.id, inlineEdit.handle, 'category', value)}
          onClose={() => setInlineEdit(null)}
        />
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{filtered.length} total</span>
          <span>·</span>
          <span>Page {page + 1} of {Math.max(1, Math.ceil(filtered.length / pageSize))}</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
            className="h-8 rounded-md border px-2 text-sm bg-background"
          >
            <option value={20}>20 / page</option>
            <option value={50}>50 / page</option>
          </select>
          <Button variant="outline" size="sm" className="h-8" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
          <Button variant="outline" size="sm" className="h-8" disabled={(page + 1) * pageSize >= filtered.length} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      </div>

      {/* History Dialog */}
      <Dialog open={!!historyTarget} onOpenChange={(open) => { if (!open) setHistoryTarget(null); }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>@{historyTarget?.handle}</DialogTitle>
          </DialogHeader>
          {loadingHistory ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-1 mb-2">
                  <FolderOpen className="w-4 h-4" /> Project History ({projectHistory.length})
                </h3>
                {projectHistory.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No project assignments</p>
                ) : (
                  <div className="space-y-2">
                    {projectHistory.map((p, i) => (
                      <div key={i} className="text-xs border rounded-lg px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{p.brand_name} / {p.project_name}</span>
                          <span className="font-medium">{formatCurrency(p.contract_amount)}</span>
                        </div>
                        <div className="flex gap-3 mt-0.5 text-muted-foreground">
                          <span>{p.signed_at ? `Signed ${new Date(p.signed_at).toLocaleDateString()}` : 'Not signed'}</span>
                          <span>{p.videos_count} videos</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-1 mb-2">
                  <History className="w-4 h-4" /> Pricing History ({history.length})
                </h3>
                {history.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No pricing records</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Date</TableHead>
                        <TableHead className="text-xs">GMV</TableHead>
                        <TableHead className="text-xs">Avg View</TableHead>
                        <TableHead className="text-xs">Price</TableHead>
                        <TableHead className="text-xs">Tier</TableHead>
                        <TableHead className="text-xs">Source</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map(h => (
                        <TableRow key={h.id}>
                          <TableCell className="text-xs">{h.recorded_at}</TableCell>
                          <TableCell className="text-xs">{h.gmv ? `$${Math.round(Number(h.gmv)).toLocaleString()}` : '-'}</TableCell>
                          <TableCell className="text-xs">{h.avg_view ? Math.round(Number(h.avg_view)).toLocaleString() : '-'}</TableCell>
                          <TableCell className="text-xs font-medium">{h.price_per_video ? `$${Math.round(Number(h.price_per_video))}` : '-'}</TableCell>
                          <TableCell className="text-xs">{h.tier || '-'}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{h.source || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Assign to Project Dialog */}
      <Dialog open={assignOpen} onOpenChange={(open) => { if (!open) { setAssignOpen(false); setAssignTarget(null); setAssignBrandId(''); setAssignProjectId(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign to Project</DialogTitle>
            <DialogDescription>@{assignTarget?.handle} → affiliate with status "Rate Received"</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Brand</Label>
              <select className="flex h-10 w-full rounded-md border px-3 py-2 text-sm bg-background"
                value={assignBrandId} onChange={(e) => { setAssignBrandId(e.target.value); setAssignProjectId(''); }}>
                <option value="">Select brand...</option>
                {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Project</Label>
              <select className="flex h-10 w-full rounded-md border px-3 py-2 text-sm bg-background"
                value={assignProjectId} onChange={(e) => setAssignProjectId(e.target.value)} disabled={!assignBrandId}>
                <option value="">{assignBrandId ? 'Select project...' : 'Select brand first'}</option>
                {allProjectsList.filter(p => p.brand_id === assignBrandId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {assignResult && <p className={cn('text-sm', assignResult.includes('success') ? 'text-emerald-600' : 'text-amber-600')}>{assignResult}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button onClick={async () => {
              if (!assignTarget || !assignBrandId || !assignProjectId) return;
              setAssigning(true); setAssignResult(null);
              try {
                const res = await fetch('/api/affiliates/auto-assign', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ handles: [assignTarget.handle], brand_id: assignBrandId, project_id: assignProjectId, status: 'Rate Received' }),
                });
                const data = await res.json();
                if (data.assigned > 0) setAssignResult('Assigned successfully');
                else if (data.skipped_duplicate > 0) setAssignResult('Already assigned to this brand');
                else setAssignResult(data.error || 'Failed');
              } catch { setAssignResult('Error'); }
              finally { setAssigning(false); }
            }} disabled={assigning || !assignBrandId || !assignProjectId}>
              {assigning ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
