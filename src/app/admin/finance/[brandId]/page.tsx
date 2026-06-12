'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2, ArrowLeft, Download, ExternalLink, ChevronLeft, ChevronRight, Video, Lock, FileCheck, Check,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import type { FinanceInvoice } from '@/types/database';
import {
  toContractInput, creatorLinesForMonth, brandMonthInvoice, brandAllTimeInvoice,
  paidInMonth, paidAllTime, type ContractInput, type CreatorInvoiceLine, type MonthBucket,
} from '@/lib/finance-invoice';

interface PCRow {
  id: string;
  contract_amount: number | null;
  assigned_video_count: number;
  signed_at: string | null;
  created_at: string;
  creator: { name: string; tiktok_handle: string };
  projects: { id: string; name: string };
  videos: { tiktok_url: string; view_count: number; gmv: number | null; status: string; created_at: string | null }[];
  payments: { amount: number; payment_date: string }[];
}

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function FinanceBrandDetailPage() {
  const params = useParams();
  const brandId = params.brandId as string;
  const supabase = useMemo(() => createSupabaseBrowser(), []);

  const [loading, setLoading] = useState(true);
  const [brandName, setBrandName] = useState('');
  const [allData, setAllData] = useState<PCRow[]>([]);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  // Role + legacy finalize state
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [invoice, setInvoice] = useState<FinanceInvoice | null>(null);
  const [showFinalizeDialog, setShowFinalizeDialog] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

  // Brand settlements (received from brand). Map key = `${year}-${month1}`.
  const [settlements, setSettlements] = useState<Map<string, number>>(new Map());
  const [settlementInput, setSettlementInput] = useState('');
  const [savingSettlement, setSavingSettlement] = useState(false);
  const [settlementMsg, setSettlementMsg] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);

      const { data: brand } = await supabase.from('brands').select('name').eq('id', brandId).single();
      if (brand) setBrandName(brand.name);

      const { data: projects } = await supabase.from('projects').select('id').eq('brand_id', brandId);
      const projectIds = (projects || []).map(p => p.id);

      if (projectIds.length === 0) { setLoading(false); return; }

      const { data, error } = await supabase
        .from('project_creators')
        .select('id, contract_amount, assigned_video_count, signed_at, created_at, creator:creators(name, tiktok_handle), projects(id, name), videos(tiktok_url, view_count, gmv, status, created_at), payments(amount, payment_date)')
        .in('project_id', projectIds)
        .not('signed_at', 'is', null)
        .or('is_deleted.is.null,is_deleted.eq.false')
        .order('signed_at', { ascending: false });

      if (!error && data) setAllData(data as unknown as PCRow[]);
      setLoading(false);
    }
    fetchData();
  }, [brandId, supabase]);

  // Load all brand settlements (resilient to the table not existing yet)
  const fetchSettlements = useCallback(async () => {
    const { data, error } = await supabase
      .from('brand_settlements')
      .select('period_year, period_month, amount')
      .eq('brand_id', brandId);
    if (error || !data) { setSettlements(new Map()); return; }
    const map = new Map<string, number>();
    for (const r of data as { period_year: number; period_month: number; amount: number }[]) {
      map.set(`${r.period_year}-${r.period_month}`, Number(r.amount) || 0);
    }
    setSettlements(map);
  }, [supabase, brandId]);

  useEffect(() => { fetchSettlements(); }, [fetchSettlements]);

  // Sync the settlement input box with the selected month
  useEffect(() => {
    const v = settlements.get(`${year}-${month + 1}`);
    setSettlementInput(v != null ? String(v) : '');
    setSettlementMsg(null);
  }, [settlements, year, month]);

  // Check super_admin role
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('admin_users')
        .select('role')
        .eq('auth_id', user.id)
        .single();
      if (data?.role === 'super_admin') setIsSuperAdmin(true);
    })();
  }, [supabase]);

  // Fetch active legacy invoice for the selected month
  const fetchInvoice = useCallback(async () => {
    const { data, error } = await supabase
      .from('finance_invoices')
      .select('*')
      .eq('brand_id', brandId)
      .eq('period_year', year)
      .eq('period_month', month + 1)
      .eq('status', 'finalized')
      .maybeSingle();
    if (!error) setInvoice((data as FinanceInvoice | null) ?? null);
  }, [supabase, brandId, year, month]);

  useEffect(() => { fetchInvoice(); }, [fetchInvoice]);

  const handleFinalize = async () => {
    setFinalizeError(null);
    setFinalizing(true);
    try {
      const { error } = await supabase.rpc('finalize_invoice', {
        p_brand_id: brandId,
        p_year: year,
        p_month: month + 1,
      });
      if (error) throw error;
      setShowFinalizeDialog(false);
      await fetchInvoice();
    } catch (e) {
      setFinalizeError(e instanceof Error ? e.message : 'Failed to finalize invoice');
    } finally {
      setFinalizing(false);
    }
  };

  const handleSaveSettlement = async () => {
    setSettlementMsg(null);
    setSavingSettlement(true);
    try {
      const amount = settlementInput.trim() === '' ? 0 : Number(settlementInput);
      if (Number.isNaN(amount)) { setSettlementMsg('Invalid amount'); return; }
      const { error } = await supabase
        .from('brand_settlements')
        .upsert(
          { brand_id: brandId, period_year: year, period_month: month + 1, amount },
          { onConflict: 'brand_id,period_year,period_month' },
        );
      if (error) { setSettlementMsg(error.message); return; }
      setSettlements(prev => {
        const next = new Map(prev);
        next.set(`${year}-${month + 1}`, amount);
        return next;
      });
      setSettlementMsg('Saved');
    } catch (e) {
      setSettlementMsg(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSavingSettlement(false);
    }
  };

  // ── derived data ────────────────────────────────────────────────────────────
  const bucket: MonthBucket = useMemo(() => ({ year, month: month + 1 }), [year, month]);

  const contracts: ContractInput[] = useMemo(
    () => allData.map(r => toContractInput(r as unknown as Parameters<typeof toContractInput>[0])),
    [allData],
  );

  const allPayments = useMemo(
    () => allData.flatMap(r => r.payments || []),
    [allData],
  );

  // Selected-month metrics
  const monthInvoice = useMemo(() => brandMonthInvoice(contracts, bucket), [contracts, bucket]);
  const monthPaid = useMemo(() => paidInMonth(allPayments, bucket), [allPayments, bucket]);

  // All-time metrics
  const allTimeInvoice = useMemo(() => brandAllTimeInvoice(contracts), [contracts]);
  const allTimePaid = useMemo(() => paidAllTime(allPayments), [allPayments]);
  const allTimeReceived = useMemo(
    () => [...settlements.values()].reduce((s, v) => s + v, 0),
    [settlements],
  );
  const allTimeMargin = allTimeReceived - allTimePaid;

  // Per-creator lines for the month, grouped by project (only rows with activity)
  const projectGroups = useMemo(() => {
    const lines = creatorLinesForMonth(contracts, bucket)
      .filter(l => l.monthInvoice !== 0 || l.postedThisMonth > 0);
    const map = new Map<string, { name: string; lines: CreatorInvoiceLine[]; total: number }>();
    for (const l of lines) {
      const existing = map.get(l.projectId) || { name: l.projectName, lines: [], total: 0 };
      existing.lines.push(l);
      existing.total += l.monthInvoice;
      map.set(l.projectId, existing);
    }
    return [...map.entries()]
      .map(([id, g]) => [id, { ...g, total: Math.round(g.total * 100) / 100 }] as const)
      .sort((a, b) => b[1].total - a[1].total);
  }, [contracts, bucket]);

  // Legacy signed-month creators (for the finalize dialog count, unchanged behavior)
  const signedMonthData = useMemo(() => {
    const startStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const endMonth = month === 11 ? 0 : month + 1;
    const endYear = month === 11 ? year + 1 : year;
    const endStr = `${endYear}-${String(endMonth + 1).padStart(2, '0')}-01`;
    return allData.filter(r => r.signed_at && r.signed_at >= startStr && r.signed_at < endStr);
  }, [allData, year, month]);

  const toggleProject = (id: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1);
  };

  const handleDownloadCsv = () => {
    const header = 'Handle,Project,Basis,Contract,Assigned,Posted This Month,Cumulative Posted,Per-Video Rate,This-Month Invoice';
    const lines = creatorLinesForMonth(contracts, bucket).filter(l => l.monthInvoice !== 0 || l.postedThisMonth > 0);
    const rows = lines.map(l => [
      l.tiktokHandle,
      l.projectName,
      l.basis,
      l.contractAmount,
      l.assignedVideoCount,
      l.postedThisMonth,
      l.cumulativePostedThroughMonth,
      l.perVideoRate,
      l.monthInvoice,
    ].join(','));
    const csv = header + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `finance-${brandName}-${MONTH_NAMES[month]}${year}.csv`;
    link.click();
    URL.revokeObjectURL(url);
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/admin/finance"><ArrowLeft className="w-4 h-4" /></Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{brandName}</h1>
            <p className="text-sm text-muted-foreground">
              Invoice by approved-video posting month (contracts signed Jun 2026+); legacy contracts by signed month.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={prevMonth}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-medium w-24 text-center">{MONTH_NAMES[month]} {year}</span>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={nextMonth}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={handleDownloadCsv} disabled={projectGroups.length === 0}>
            <Download className="w-4 h-4 mr-2" />
            CSV
          </Button>
        </div>
      </div>

      {/* Month metric strip */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Invoice (this month)</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCurrency(monthInvoice)}</p>
            <p className="text-xs text-muted-foreground mt-1">Computed from posted videos</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Paid to creators (this month)</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCurrency(monthPaid)}</p>
            <p className="text-xs text-muted-foreground mt-1">By payment date</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Received from brand (this month)</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={settlementInput}
                  onChange={(e) => setSettlementInput(e.target.value)}
                  disabled={!isSuperAdmin}
                  placeholder="0"
                  className="h-9 pl-6"
                />
              </div>
              {isSuperAdmin && (
                <Button size="sm" className="h-9" onClick={handleSaveSettlement} disabled={savingSettlement}>
                  {savingSettlement ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {settlementMsg ? <span className={settlementMsg === 'Saved' ? 'text-emerald-600' : 'text-amber-600'}>{settlementMsg}</span>
                : isSuperAdmin ? 'Manual monthly entry' : 'Super admin only'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* All-time margin chip */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border bg-muted/30 px-4 py-2 text-sm">
        <span className="text-muted-foreground">All-time</span>
        <span>Invoice <strong>{formatCurrency(allTimeInvoice)}</strong></span>
        <span>Paid <strong>{formatCurrency(allTimePaid)}</strong></span>
        <span>Received <strong>{formatCurrency(allTimeReceived)}</strong></span>
        <span>Margin (received − paid) <strong className={allTimeMargin >= 0 ? 'text-emerald-600' : 'text-red-600'}>{formatCurrency(allTimeMargin)}</strong></span>
      </div>

      {/* Per-creator pro-rata breakdown */}
      {projectGroups.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <p className="text-center text-muted-foreground">No invoice activity for {MONTH_NAMES[month]} {year}</p>
          </CardContent>
        </Card>
      ) : (
        projectGroups.map(([projId, group]) => {
          const isExpanded = expandedProjects.has(projId);
          return (
            <Card key={projId}>
              <CardHeader
                className="cursor-pointer hover:bg-muted/50 transition-colors py-4"
                onClick={() => toggleProject(projId)}
              >
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{isExpanded ? '▼' : '▶'}</span>
                    {group.name}
                    <Badge variant="secondary" className="text-xs">{group.lines.length} creators</Badge>
                  </CardTitle>
                  <span className="font-bold">{formatCurrency(group.total)}</span>
                </div>
              </CardHeader>
              {isExpanded && (
                <CardContent className="p-0 border-t">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Creator</TableHead>
                        <TableHead>Basis</TableHead>
                        <TableHead className="text-right">Contract</TableHead>
                        <TableHead className="text-center">Posted (mo / total)</TableHead>
                        <TableHead className="text-right">Per video</TableHead>
                        <TableHead className="text-right">This-month invoice</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.lines.map(l => (
                        <TableRow key={l.projectCreatorId}>
                          <TableCell>
                            <a
                              href={`https://www.tiktok.com/@${l.tiktokHandle}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                            >
                              @{l.tiktokHandle}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                            <p className="text-xs text-muted-foreground">{l.creatorName}</p>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn('text-xs',
                              l.basis === 'video' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-muted-foreground/30 text-muted-foreground')}>
                              {l.basis}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">{formatCurrency(l.contractAmount)}</TableCell>
                          <TableCell className="text-center">
                            {l.basis === 'video' ? (
                              <span className="text-sm inline-flex items-center gap-1">
                                <Video className="w-3 h-3 text-muted-foreground" />
                                {l.postedThisMonth} / {l.cumulativePostedThroughMonth}
                                <span className="text-muted-foreground">of {l.assignedVideoCount}</span>
                              </span>
                            ) : <span className="text-xs text-muted-foreground">-</span>}
                          </TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">
                            {l.basis === 'video' && l.perVideoRate > 0 ? formatCurrency(l.perVideoRate) : '-'}
                          </TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(l.monthInvoice)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              )}
            </Card>
          );
        })
      )}

      {/* Legacy finalize (signed-month snapshot) */}
      {isSuperAdmin && (
        <div className="flex items-center justify-between rounded-lg border border-dashed px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {invoice ? (
              <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700 gap-1">
                <Lock className="w-3 h-3" />
                Legacy snapshot finalized · {new Date(invoice.finalized_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </Badge>
            ) : (
              <span>Legacy signed-month snapshot (optional lock)</span>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setFinalizeError(null); setShowFinalizeDialog(true); }}
            disabled={signedMonthData.length === 0}
          >
            <FileCheck className="w-4 h-4 mr-2" />
            {invoice ? 'Re-finalize (legacy)' : 'Finalize (legacy)'}
          </Button>
        </div>
      )}

      {/* Finalize Invoice Dialog (legacy) */}
      <Dialog open={showFinalizeDialog} onOpenChange={(open) => { if (!finalizing) setShowFinalizeDialog(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{invoice ? 'Re-finalize Legacy Invoice' : 'Finalize Legacy Invoice'}</DialogTitle>
            <DialogDescription className="space-y-2 pt-2">
              <span className="block"><strong>{brandName}</strong> · {MONTH_NAMES[month]} {year}</span>
              <span className="block">
                {signedMonthData.filter(r => (r.contract_amount || 0) > 0).length} creators signed this month · {formatCurrency(signedMonthData.filter(r => (r.contract_amount || 0) > 0).reduce((s, r) => s + (r.contract_amount || 0), 0))}
              </span>
              <span className="block text-xs text-muted-foreground">
                This is the legacy signed-month snapshot. The active invoice number above is computed live from posted videos.
              </span>
              {invoice && (
                <span className="block mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                  Already finalized on {new Date(invoice.finalized_at).toLocaleString()}. The previous version will be superseded.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {finalizeError && <p className="text-sm text-destructive">{finalizeError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFinalizeDialog(false)} disabled={finalizing}>Cancel</Button>
            <Button onClick={handleFinalize} disabled={finalizing}>
              {finalizing ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />Finalizing...</>) : (<>{invoice ? 'Re-finalize' : 'Finalize'}</>)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
