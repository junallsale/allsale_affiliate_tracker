'use client';

import { useCallback, useRef, useState } from 'react';
import { ExternalLink, MessageSquare, Copy, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AffiliateCreator, AffiliateCustomColumn } from '@/types/database';
import type { ColumnDef } from '@/lib/affiliate-columns';
import EditableCell from './EditableCell';
import SelectCell from './SelectCell';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

interface BrandOption {
  id: string;
  name: string;
}

interface ProjectOption {
  id: string;
  name: string;
  brand_id: string;
}

interface AffiliateTableProps {
  data: AffiliateCreator[];
  columns: ColumnDef[];
  customColumns: AffiliateCustomColumn[];
  visibleColumns: string[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onCellUpdate: (id: string, key: string, value: unknown) => void;
  onOpenComments: (id: string, handle: string) => void;
  onDuplicate?: (row: AffiliateCreator) => void;
  editable?: boolean;
  brands: BrandOption[];
  projects: ProjectOption[];
  onStatusChangeBlocked?: (message: string) => void;
}

export function AffiliateTable({
  data,
  columns,
  customColumns,
  visibleColumns,
  selectedIds,
  onSelectionChange,
  onCellUpdate,
  onOpenComments,
  onDuplicate,
  editable = true,
  brands,
  projects,
  onStatusChangeBlocked,
}: AffiliateTableProps) {
  // Confirm dialog for status → Confirmed
  const [confirmRow, setConfirmRow] = useState<AffiliateCreator | null>(null);
  const [confirmVideos, setConfirmVideos] = useState('');
  const [confirmContract, setConfirmContract] = useState('');

  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const debouncedUpdate = useCallback(
    (id: string, key: string, value: unknown) => {
      const timerKey = `${id}-${key}`;
      const existing = debounceTimers.current.get(timerKey);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        onCellUpdate(id, key, value);
        debounceTimers.current.delete(timerKey);
      }, 300);
      debounceTimers.current.set(timerKey, timer);
    },
    [onCellUpdate]
  );

  // Build brand options for SelectCell
  const brandOptions = brands.map((b) => ({ value: b.id, color: '#6366f1', label: b.name }));

  // Build project options per brand
  const getProjectOptions = (brandId: string | null) => {
    if (!brandId) return [];
    return projects
      .filter((p) => p.brand_id === brandId)
      .map((p) => ({ value: p.id, color: '#8b5cf6', label: p.name }));
  };

  const allColumns: (ColumnDef & { isCustom?: boolean })[] = [
    ...columns.filter((c) => visibleColumns.includes(c.key)),
    ...customColumns
      .filter((c) => visibleColumns.includes(c.key))
      .map((c) => ({
        key: c.key,
        label: c.name,
        type: c.column_type as ColumnDef['type'],
        editable: true,
        options: c.options,
        width: 140,
        isCustom: true,
      })),
  ];

  const isAllSelected = data.length > 0 && selectedIds.size === data.length;

  const toggleAll = () => {
    if (isAllSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(data.map((d) => d.id)));
    }
  };

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  const getCellValue = (row: AffiliateCreator, col: ColumnDef & { isCustom?: boolean }) => {
    if (col.isCustom) {
      return (row.custom_data as Record<string, unknown>)?.[col.key] ?? null;
    }
    return (row as unknown as Record<string, unknown>)[col.key] ?? null;
  };

  const formatNumber = (val: unknown): string => {
    if (val === null || val === undefined) return '';
    const n = typeof val === 'number' ? val : parseFloat(String(val));
    if (isNaN(n)) return '';
    return Math.round(n).toLocaleString();
  };

  // Handle status change with validation
  const handleStatusChange = (row: AffiliateCreator, newStatus: string | null) => {
    if (newStatus === 'Confirmed') {
      if (!row.brand_id) {
        onStatusChangeBlocked?.('Please select a brand first');
        return;
      }
      if (!row.project_id) {
        onStatusChangeBlocked?.('Please select a project first');
        return;
      }
      // Show confirmation dialog
      const contractAmt = row.contract_amount || (row.planned_video_count || 0) * (row.price_per_video || 0);
      setConfirmRow(row);
      setConfirmVideos(String(row.planned_video_count || 1));
      setConfirmContract(String(contractAmt || 0));
      return;
    }
    debouncedUpdate(row.id, 'status', newStatus);
  };

  const handleConfirmSubmit = () => {
    if (!confirmRow) return;
    const videos = parseInt(confirmVideos) || 1;
    const contract = parseFloat(confirmContract) || 0;
    // Update video count and contract first, then status
    onCellUpdate(confirmRow.id, 'planned_video_count', videos);
    onCellUpdate(confirmRow.id, 'price_per_video', videos > 0 ? contract / videos : 0);
    // Small delay to ensure fields update before status triggers project_creator creation
    setTimeout(() => {
      onCellUpdate(confirmRow.id, 'status', 'Confirmed');
    }, 500);
    setConfirmRow(null);
  };

  // Handle brand change: clear project if brand changes
  const handleBrandChange = (row: AffiliateCreator, newBrandId: string | null) => {
    debouncedUpdate(row.id, 'brand_id', newBrandId);
    // Clear project_id if brand changed
    if (newBrandId !== row.brand_id) {
      onCellUpdate(row.id, 'project_id', null);
    }
  };

  return (
    <>
    <TooltipProvider>
      <div className="border rounded-lg overflow-auto max-h-[calc(100vh-280px)]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
            <tr className="border-b">
              {editable && (
                <th className="w-10 px-3 py-2 text-left">
                  <Checkbox
                    checked={isAllSelected}
                    onCheckedChange={toggleAll}
                  />
                </th>
              )}
              <th className="sticky left-0 z-20 bg-muted/80 backdrop-blur-sm px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap min-w-[160px]">
                Handle
              </th>
              {allColumns
                .filter((c) => c.key !== 'handle')
                .map((col) => (
                  <th
                    key={col.key}
                    className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap"
                    style={{ minWidth: col.width || 120 }}
                  >
                    {col.label}
                  </th>
                ))}
              {editable && (
                <th className="w-10 px-3 py-2" />
              )}
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  'border-b hover:bg-muted/30 transition-colors',
                  selectedIds.has(row.id) && 'bg-primary/5'
                )}
              >
                {editable && (
                  <td className="px-3 py-1.5">
                    <Checkbox
                      checked={selectedIds.has(row.id)}
                      onCheckedChange={() => toggleOne(row.id)}
                    />
                  </td>
                )}
                {/* Handle column - sticky */}
                <td className="sticky left-0 z-10 bg-background px-3 py-1.5 whitespace-nowrap">
                  <a
                    href={`https://www.tiktok.com/@${String(row.handle).replace(/^@+/, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline font-medium inline-flex items-center gap-1"
                  >
                    @{String(row.handle).replace(/^@+/, '')}
                    <ExternalLink className="h-3 w-3 opacity-50" />
                  </a>
                </td>
                {allColumns
                  .filter((c) => c.key !== 'handle')
                  .map((col) => {
                    const value = getCellValue(row, col);

                    // Brand column: custom select with brand names as labels
                    if (col.key === 'brand_id') {
                      return (
                        <td key={col.key} className="px-3 py-1.5">
                          <SelectCell
                            value={value as string | null}
                            options={brandOptions}
                            editable={editable && col.editable}
                            onChange={(v) => handleBrandChange(row, v)}
                            displayLabel={(v) => brands.find((b) => b.id === v)?.name}
                          />
                        </td>
                      );
                    }

                    // Project column: filtered by brand
                    if (col.key === 'project_id') {
                      const projOptions = getProjectOptions(row.brand_id);
                      return (
                        <td key={col.key} className="px-3 py-1.5">
                          <SelectCell
                            value={value as string | null}
                            options={projOptions}
                            editable={editable && col.editable && !!row.brand_id}
                            onChange={(v) => debouncedUpdate(row.id, 'project_id', v)}
                            displayLabel={(v) => projects.find((p) => p.id === v)?.name}
                          />
                        </td>
                      );
                    }

                    // Status column: with validation
                    if (col.key === 'status') {
                      return (
                        <td key={col.key} className="px-3 py-1.5">
                          <SelectCell
                            value={value as string | null}
                            options={col.options || []}
                            editable={editable && col.editable}
                            onChange={(v) => handleStatusChange(row, v)}
                          />
                        </td>
                      );
                    }

                    if ((col.type === 'select' || col.type === 'multi_select') && col.key !== 'brand_id' && col.key !== 'project_id' && col.key !== 'status') {
                      return (
                        <td key={col.key} className="px-3 py-1.5">
                          <SelectCell
                            value={value as string | null}
                            options={col.options || []}
                            editable={editable && col.editable}
                            onChange={(v) => debouncedUpdate(row.id, col.key, v)}
                          />
                        </td>
                      );
                    }

                    if (col.type === 'computed') {
                      return (
                        <td key={col.key} className="px-3 py-1.5 text-right font-medium tabular-nums">
                          {value ? formatNumber(value) : <span className="text-muted-foreground/40">—</span>}
                        </td>
                      );
                    }

                    return (
                      <td key={col.key} className="px-3 py-1.5">
                        <EditableCell
                          value={value as string | number | null}
                          type={col.type as 'text' | 'number' | 'link' | 'email' | 'date' | 'computed'}
                          editable={editable && col.editable}
                          onChange={(v) => debouncedUpdate(row.id, col.key, v)}
                        />
                      </td>
                    );
                  })}
                {editable && (
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-0.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => onDuplicate?.(row)}
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>복제 (다른 프로젝트 배정용)</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => onOpenComments(row.id, row.handle)}
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <MessageSquare className="h-4 w-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Comments</TooltipContent>
                      </Tooltip>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {data.length === 0 && (
              <tr>
                <td
                  colSpan={allColumns.length + (editable ? 2 : 0) + 1}
                  className="px-4 py-12 text-center text-muted-foreground"
                >
                  No data found. Import CSV or add creators manually.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </TooltipProvider>

    {/* Confirm Dialog for status → Confirmed */}
    <Dialog open={!!confirmRow} onOpenChange={(open) => { if (!open) setConfirmRow(null); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Confirm Creator
          </DialogTitle>
          <DialogDescription>
            {confirmRow && (
              <>Confirm <span className="font-semibold">@{confirmRow.handle}</span> and create project creator.</>
            )}
          </DialogDescription>
        </DialogHeader>
        {confirmRow && (
          <div className="space-y-4">
            <div className="bg-muted/50 rounded-lg p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Brand</span>
                <span className="font-medium">{brands.find(b => b.id === confirmRow.brand_id)?.name || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Project</span>
                <span className="font-medium">{projects.find(p => p.id === confirmRow.project_id)?.name || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Price/Video</span>
                <span className="font-medium">${confirmRow.price_per_video?.toLocaleString() || '0'}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Assigned Videos</Label>
                <Input
                  type="number"
                  min={1}
                  value={confirmVideos}
                  onChange={(e) => setConfirmVideos(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Contract Amount ($)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={confirmContract}
                  onChange={(e) => setConfirmContract(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmRow(null)}>Cancel</Button>
          <Button onClick={handleConfirmSubmit}>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
