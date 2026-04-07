'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { Loader2, DollarSign, TrendingUp, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { createSupabaseBrowser } from '@/lib/supabase-browser';

interface PCRow {
  contract_amount: number;
  created_at: string;
  signed_at: string | null;
  projects: {
    id: string;
    name: string;
    brand_id: string;
    brands: { id: string; name: string };
  };
}

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function FinancePage() {
  const supabase = useMemo(() => createSupabaseBrowser(), []);
  const [loading, setLoading] = useState(true);
  const [allData, setAllData] = useState<PCRow[]>([]);

  // Current month view (default: this month)
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-indexed

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      const { data, error } = await supabase
        .from('project_creators')
        .select('contract_amount, created_at, signed_at, projects(id, name, brand_id, brands(id, name))')
        .or('is_deleted.is.null,is_deleted.eq.false')
        .not('signed_at', 'is', null)
        .order('created_at', { ascending: false });

      if (!error && data) {
        setAllData(data as unknown as PCRow[]);
      }
      setLoading(false);
    }
    fetchData();
  }, [supabase]);

  // Filter by selected month
  const monthData = useMemo(() => {
    const startStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const endMonth = month === 11 ? 0 : month + 1;
    const endYear = month === 11 ? year + 1 : year;
    const endStr = `${endYear}-${String(endMonth + 1).padStart(2, '0')}-01`;

    return allData.filter(row => row.signed_at && row.signed_at >= startStr && row.signed_at < endStr);
  }, [allData, year, month]);

  // Group by brand → project
  interface ProjectSummary { name: string; total: number; count: number; freeCount: number }
  interface BrandSummary { id: string; name: string; total: number; count: number; freeCount: number; projects: ProjectSummary[] }

  const brandSummary = useMemo(() => {
    const map = new Map<string, BrandSummary>();

    for (const row of monthData) {
      const brandName = row.projects?.brands?.name || 'Unknown';
      const brandId = row.projects?.brands?.id || 'unknown';
      const projectName = row.projects?.name || 'Unknown';

      const existing = map.get(brandId) || { id: brandId, name: brandName, total: 0, count: 0, freeCount: 0, projects: [] };
      existing.total += row.contract_amount || 0;
      existing.count += 1;
      if (!row.contract_amount || row.contract_amount === 0) existing.freeCount += 1;

      // Project level
      let proj = existing.projects.find(p => p.name === projectName);
      if (!proj) {
        proj = { name: projectName, total: 0, count: 0, freeCount: 0 };
        existing.projects.push(proj);
      }
      proj.total += row.contract_amount || 0;
      proj.count += 1;
      if (!row.contract_amount || row.contract_amount === 0) proj.freeCount += 1;

      map.set(brandId, existing);
    }

    const result = [...map.values()].sort((a, b) => b.total - a.total);
    result.forEach(b => b.projects.sort((a, b) => b.total - a.total));
    return result;
  }, [monthData]);

  const grandTotal = brandSummary.reduce((s, b) => s + b.total, 0);
  const totalCreators = brandSummary.reduce((s, b) => s + b.count, 0);
  const totalFree = brandSummary.reduce((s, b) => s + b.freeCount, 0);

  // Monthly trend (last 6 months)
  const monthlyTrend = useMemo(() => {
    const months: { label: string; total: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(year, month - i, 1);
      const m = d.getMonth();
      const y = d.getFullYear();
      const startStr = `${y}-${String(m + 1).padStart(2, '0')}-01`;
      const endM = m === 11 ? 0 : m + 1;
      const endY = m === 11 ? y + 1 : y;
      const endStr = `${endY}-${String(endM + 1).padStart(2, '0')}-01`;

      const total = allData
        .filter(row => row.signed_at && row.signed_at >= startStr && row.signed_at < endStr)
        .reduce((s, row) => s + (row.contract_amount || 0), 0);

      months.push({ label: `${MONTH_NAMES[m]} ${y}`, total });
    }
    return months;
  }, [allData, year, month]);

  const maxTrend = Math.max(...monthlyTrend.map(m => m.total), 1);

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };

  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  const [expandedBrands, setExpandedBrands] = useState<Set<string>>(new Set());
  const toggleBrand = (name: string) => {
    setExpandedBrands(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
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
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <DollarSign className="w-6 h-6" />
            Finance
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monthly contract amounts by brand
          </p>
        </div>

        {/* Month selector */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={prevMonth}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium w-24 text-center">
            {MONTH_NAMES[month]} {year}
          </span>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={nextMonth}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Contracts</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{formatCurrency(grandTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Creators Added</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{totalCreators}</p>
            {totalFree > 0 && <p className="text-xs text-muted-foreground mt-1">{totalFree} free collabs</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg. Contract</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              {totalCreators - totalFree > 0
                ? formatCurrency(grandTotal / (totalCreators - totalFree))
                : '$0'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">excl. free</p>
          </CardContent>
        </Card>
      </div>

      {/* Brand breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">By Brand — {MONTH_NAMES[month]} {year}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Brand</TableHead>
                <TableHead className="text-right">Creators</TableHead>
                <TableHead className="text-right">Free</TableHead>
                <TableHead className="text-right">Contract Total</TableHead>
                <TableHead className="text-right">Avg</TableHead>
                <TableHead className="w-[200px]">Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {brandSummary.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No data for this month
                  </TableCell>
                </TableRow>
              ) : (
                brandSummary.flatMap((brand) => {
                  const paidCount = brand.count - brand.freeCount;
                  const avg = paidCount > 0 ? brand.total / paidCount : 0;
                  const share = grandTotal > 0 ? (brand.total / grandTotal) * 100 : 0;
                  const isExpanded = expandedBrands.has(brand.name);

                  return [
                    <TableRow key={brand.name} className="cursor-pointer hover:bg-muted/50" onClick={() => toggleBrand(brand.name)}>
                      <TableCell className="font-medium">
                        <span className="mr-1 text-xs text-muted-foreground">{isExpanded ? '▼' : '▶'}</span>
                        <Link
                          href={`/admin/finance/${brand.id}`}
                          className="text-blue-600 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {brand.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right">{brand.count}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{brand.freeCount || '-'}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(brand.total)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{formatCurrency(avg)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${share}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground w-10 text-right">{Math.round(share)}%</span>
                        </div>
                      </TableCell>
                    </TableRow>,
                    ...(isExpanded ? brand.projects.map((proj) => {
                      const projPaid = proj.count - proj.freeCount;
                      const projAvg = projPaid > 0 ? proj.total / projPaid : 0;
                      return (
                        <TableRow key={`${brand.name}-${proj.name}`} className="bg-muted/30">
                          <TableCell className="pl-10 text-sm text-muted-foreground">{proj.name}</TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">{proj.count}</TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">{proj.freeCount || '-'}</TableCell>
                          <TableCell className="text-right text-sm">{formatCurrency(proj.total)}</TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">{formatCurrency(projAvg)}</TableCell>
                          <TableCell />
                        </TableRow>
                      );
                    }) : []),
                  ];
                })
              )}
              {brandSummary.length > 0 && (
                <TableRow className="bg-muted/50 font-medium">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">{totalCreators}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{totalFree || '-'}</TableCell>
                  <TableCell className="text-right">{formatCurrency(grandTotal)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {totalCreators - totalFree > 0 ? formatCurrency(grandTotal / (totalCreators - totalFree)) : '-'}
                  </TableCell>
                  <TableCell />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Monthly trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            6-Month Trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {monthlyTrend.map((m) => (
              <div key={m.label} className="flex items-center gap-3">
                <span className={cn('text-xs w-16', m.label === `${MONTH_NAMES[month]} ${year}` ? 'font-bold' : 'text-muted-foreground')}>
                  {m.label}
                </span>
                <div className="flex-1 h-6 bg-muted rounded overflow-hidden">
                  <div
                    className={cn('h-full rounded', m.label === `${MONTH_NAMES[month]} ${year}` ? 'bg-primary' : 'bg-primary/40')}
                    style={{ width: `${(m.total / maxTrend) * 100}%` }}
                  />
                </div>
                <span className={cn('text-sm w-20 text-right', m.label === `${MONTH_NAMES[month]} ${year}` ? 'font-bold' : 'text-muted-foreground')}>
                  {formatCurrency(m.total)}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
