'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Loader2, DollarSign, TrendingUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import { isDemoBrandId } from '@/lib/demo';
import {
  toContractInput, brandMonthInvoice, brandAllTimeInvoice,
  paidInMonth, paidAllTime, type ContractInput, type MonthBucket,
} from '@/lib/finance-invoice';

interface PCRow {
  id: string;
  contract_amount: number | null;
  assigned_video_count: number;
  signed_at: string | null;
  projects: {
    id: string;
    name: string;
    brand_id: string;
    brands: { id: string; name: string };
  };
  videos: { status: string; created_at: string | null }[];
  payments: { amount: number; payment_date: string }[];
}

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface BrandRow {
  id: string;
  name: string;
  contracts: ContractInput[];
  payments: { amount: number; payment_date: string }[];
}

export default function FinancePage() {
  const supabase = useMemo(() => createSupabaseBrowser(), []);
  const [loading, setLoading] = useState(true);
  const [allData, setAllData] = useState<PCRow[]>([]);
  // settlements: brandId -> (`${year}-${month1}` -> amount)
  const [settlements, setSettlements] = useState<Map<string, Map<string, number>>>(new Map());

  const [viewMode, setViewMode] = useState<'all' | 'month'>('all');
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      // Paginate to fetch all project_creators (Supabase 1000-row default)
      const rows: PCRow[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from('project_creators')
          .select('id, contract_amount, assigned_video_count, signed_at, projects(id, name, brand_id, brands(id, name)), videos(status, created_at), payments(amount, payment_date)')
          .or('is_deleted.is.null,is_deleted.eq.false')
          .not('signed_at', 'is', null)
          .range(from, from + pageSize - 1);
        if (error || !data || data.length === 0) break;
        rows.push(...(data as unknown as PCRow[]));
        if (data.length < pageSize) break;
        from += pageSize;
      }
      setAllData(rows.filter(r => !isDemoBrandId(r.projects?.brand_id)));

      // Brand settlements (resilient to table not existing yet)
      const { data: sData } = await supabase
        .from('brand_settlements')
        .select('brand_id, period_year, period_month, amount');
      const map = new Map<string, Map<string, number>>();
      for (const s of (sData || []) as { brand_id: string; period_year: number; period_month: number; amount: number }[]) {
        if (!map.has(s.brand_id)) map.set(s.brand_id, new Map());
        map.get(s.brand_id)!.set(`${s.period_year}-${s.period_month}`, Number(s.amount) || 0);
      }
      setSettlements(map);

      setLoading(false);
    }
    fetchData();
  }, [supabase]);

  const bucket: MonthBucket = useMemo(() => ({ year, month: month + 1 }), [year, month]);

  // Group rows by brand → ContractInput[] + payments[]
  const brands: BrandRow[] = useMemo(() => {
    const map = new Map<string, BrandRow>();
    for (const row of allData) {
      const brandId = row.projects?.brands?.id || row.projects?.brand_id || 'unknown';
      const brandName = row.projects?.brands?.name || 'Unknown';
      const existing = map.get(brandId) || { id: brandId, name: brandName, contracts: [], payments: [] };
      existing.contracts.push(toContractInput(row as unknown as Parameters<typeof toContractInput>[0]));
      existing.payments.push(...(row.payments || []));
      map.set(brandId, existing);
    }
    return [...map.values()];
  }, [allData]);

  const receivedFor = (brandId: string): number => {
    const bm = settlements.get(brandId);
    if (!bm) return 0;
    if (viewMode === 'all') return [...bm.values()].reduce((s, v) => s + v, 0);
    return bm.get(`${year}-${month + 1}`) ?? 0;
  };

  // Per-brand metrics for the active view
  const brandMetrics = useMemo(() => {
    return brands.map(b => {
      const invoice = viewMode === 'all' ? brandAllTimeInvoice(b.contracts) : brandMonthInvoice(b.contracts, bucket);
      const paid = viewMode === 'all' ? paidAllTime(b.payments) : paidInMonth(b.payments, bucket);
      const received = receivedFor(b.id);
      return { id: b.id, name: b.name, invoice, paid, received, margin: received - paid };
    }).sort((a, b) => b.invoice - a.invoice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brands, settlements, viewMode, bucket]);

  const totals = useMemo(() => brandMetrics.reduce(
    (acc, b) => ({
      invoice: acc.invoice + b.invoice,
      paid: acc.paid + b.paid,
      received: acc.received + b.received,
      margin: acc.margin + b.margin,
    }),
    { invoice: 0, paid: 0, received: 0, margin: 0 },
  ), [brandMetrics]);

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const visibleBrands = brandMetrics.filter(b => b.invoice !== 0 || b.paid !== 0 || b.received !== 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <DollarSign className="w-6 h-6" />
            Finance
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Invoice (computed from posted videos), paid to creators, and received from brands — per brand
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded-md border p-0.5">
            <button
              onClick={() => setViewMode('all')}
              className={cn('px-3 py-1 text-sm rounded', viewMode === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
            >
              All-time
            </button>
            <button
              onClick={() => setViewMode('month')}
              className={cn('px-3 py-1 text-sm rounded', viewMode === 'month' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
            >
              Monthly
            </button>
          </div>
          {viewMode === 'month' && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={prevMonth}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm font-medium w-24 text-center">{MONTH_NAMES[month]} {year}</span>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={nextMonth}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Invoice</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{formatCurrency(totals.invoice)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Paid to Creators</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{formatCurrency(totals.paid)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Received from Brands</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{formatCurrency(totals.received)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Margin (received − paid)</CardTitle></CardHeader>
          <CardContent><p className={cn('text-2xl font-bold', totals.margin >= 0 ? 'text-emerald-600' : 'text-red-600')}>{formatCurrency(totals.margin)}</p></CardContent>
        </Card>
      </div>

      {/* Per-brand table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            By Brand — {viewMode === 'all' ? 'All-time' : `${MONTH_NAMES[month]} ${year}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Brand</TableHead>
                <TableHead className="text-right">Invoice</TableHead>
                <TableHead className="text-right">Paid to creators</TableHead>
                <TableHead className="text-right">Received from brand</TableHead>
                <TableHead className="text-right">Margin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleBrands.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No data</TableCell>
                </TableRow>
              ) : (
                visibleBrands.map(b => (
                  <TableRow key={b.id} className="hover:bg-muted/50">
                    <TableCell className="font-medium">
                      <Link href={`/admin/finance/${b.id}`} className="text-blue-600 hover:underline">{b.name}</Link>
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(b.invoice)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatCurrency(b.paid)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatCurrency(b.received)}</TableCell>
                    <TableCell className={cn('text-right font-medium', b.margin >= 0 ? 'text-emerald-600' : 'text-red-600')}>{formatCurrency(b.margin)}</TableCell>
                  </TableRow>
                ))
              )}
              {visibleBrands.length > 0 && (
                <TableRow className="bg-muted/50 font-medium">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">{formatCurrency(totals.invoice)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(totals.paid)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(totals.received)}</TableCell>
                  <TableCell className={cn('text-right', totals.margin >= 0 ? 'text-emerald-600' : 'text-red-600')}>{formatCurrency(totals.margin)}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <TrendingUp className="w-3.5 h-3.5" />
        Invoice = posted approved videos × per-video rate (contracts signed Jun 2026+); pre-cutover contracts by signed month. The three metrics run on independent timelines, so monthly figures are not reconciled — margin is meaningful cumulatively (All-time).
      </p>
    </div>
  );
}
