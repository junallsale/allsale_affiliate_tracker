'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2, ArrowLeft, Download, ExternalLink, ChevronLeft, ChevronRight, Video,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { createSupabaseBrowser } from '@/lib/supabase-browser';

interface CreatorRow {
  id: string;
  contract_amount: number;
  assigned_video_count: number;
  signed_at: string | null;
  created_at: string;
  creator: { name: string; tiktok_handle: string };
  projects: { id: string; name: string };
  videos: { tiktok_url: string; view_count: number; gmv: number | null }[];
}

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function FinanceBrandDetailPage() {
  const params = useParams();
  const router = useRouter();
  const brandId = params.brandId as string;
  const supabase = useMemo(() => createSupabaseBrowser(), []);

  const [loading, setLoading] = useState(true);
  const [brandName, setBrandName] = useState('');
  const [allData, setAllData] = useState<CreatorRow[]>([]);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function fetchData() {
      setLoading(true);

      // Get brand name
      const { data: brand } = await supabase.from('brands').select('name').eq('id', brandId).single();
      if (brand) setBrandName(brand.name);

      // Get all project_creators for this brand
      const { data: projects } = await supabase.from('projects').select('id').eq('brand_id', brandId);
      const projectIds = (projects || []).map(p => p.id);

      if (projectIds.length === 0) { setLoading(false); return; }

      const { data, error } = await supabase
        .from('project_creators')
        .select('id, contract_amount, assigned_video_count, signed_at, created_at, creator:creators(name, tiktok_handle), projects(id, name), videos(tiktok_url, view_count, gmv)')
        .in('project_id', projectIds)
        .not('signed_at', 'is', null)
        .or('is_deleted.is.null,is_deleted.eq.false')
        .order('signed_at', { ascending: false });

      if (!error && data) setAllData(data as unknown as CreatorRow[]);
      setLoading(false);
    }
    fetchData();
  }, [brandId, supabase]);

  // Filter by month (based on signed_at)
  const monthData = useMemo(() => {
    const startStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const endMonth = month === 11 ? 0 : month + 1;
    const endYear = month === 11 ? year + 1 : year;
    const endStr = `${endYear}-${String(endMonth + 1).padStart(2, '0')}-01`;
    return allData.filter(row => row.signed_at && row.signed_at >= startStr && row.signed_at < endStr);
  }, [allData, year, month]);

  // Group by project
  const projectGroups = useMemo(() => {
    const map = new Map<string, { name: string; creators: CreatorRow[]; total: number }>();
    for (const row of monthData) {
      const projId = row.projects?.id || 'unknown';
      const projName = row.projects?.name || 'Unknown';
      const existing = map.get(projId) || { name: projName, creators: [], total: 0 };
      existing.creators.push(row);
      existing.total += row.contract_amount || 0;
      map.set(projId, existing);
    }
    return [...map.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [monthData]);

  const grandTotal = monthData.reduce((s, r) => s + (r.contract_amount || 0), 0);

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
    const header = 'Handle,TikTok Profile,Contract Amount,Assigned Videos,Uploaded Videos,Project,Signed Date,Video URLs';
    const rows = monthData.map(r => {
      const handle = r.creator?.tiktok_handle || '';
      const videoUrls = (r.videos || []).map(v => v.tiktok_url).join(' | ');
      return [
        handle,
        `https://www.tiktok.com/@${handle}`,
        r.contract_amount || 0,
        r.assigned_video_count || 0,
        (r.videos || []).length,
        r.projects?.name || '',
        r.signed_at ? new Date(r.signed_at).toLocaleDateString() : '',
        `"${videoUrls}"`,
      ].join(',');
    });
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
              {monthData.length} creators · {formatCurrency(grandTotal)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Month selector */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={prevMonth}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-medium w-24 text-center">{MONTH_NAMES[month]} {year}</span>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={nextMonth}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={handleDownloadCsv} disabled={monthData.length === 0}>
            <Download className="w-4 h-4 mr-2" />
            CSV
          </Button>
        </div>
      </div>

      {/* Project groups */}
      {projectGroups.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <p className="text-center text-muted-foreground">No signed contracts for {MONTH_NAMES[month]} {year}</p>
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
                    <Badge variant="secondary" className="text-xs">{group.creators.length} creators</Badge>
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
                        <TableHead className="text-right">Contract</TableHead>
                        <TableHead className="text-center">Videos</TableHead>
                        <TableHead>Video Links</TableHead>
                        <TableHead>Signed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.creators.map(row => (
                        <TableRow key={row.id}>
                          <TableCell>
                            <a
                              href={`https://www.tiktok.com/@${row.creator?.tiktok_handle}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                            >
                              @{row.creator?.tiktok_handle}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                            <p className="text-xs text-muted-foreground">{row.creator?.name}</p>
                          </TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(row.contract_amount || 0)}</TableCell>
                          <TableCell className="text-center">
                            <span className={cn('text-sm', (row.videos || []).length >= row.assigned_video_count && row.assigned_video_count > 0 ? 'text-emerald-600 font-medium' : '')}>
                              {(row.videos || []).length}/{row.assigned_video_count || 0}
                            </span>
                          </TableCell>
                          <TableCell>
                            {(row.videos || []).length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {row.videos.map((v, i) => (
                                  <a
                                    key={i}
                                    href={v.tiktok_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-0.5 text-xs text-blue-600 hover:underline bg-blue-50 px-1.5 py-0.5 rounded"
                                  >
                                    <Video className="w-3 h-3" />
                                    {i + 1}
                                  </a>
                                ))}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {row.signed_at ? new Date(row.signed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'}
                          </TableCell>
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
    </div>
  );
}
