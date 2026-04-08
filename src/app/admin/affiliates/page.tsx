'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Upload, UserPlus, FolderInput, Search, Columns3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AffiliateTable } from '@/components/affiliate-table/AffiliateTable';
import ViewManager from '@/components/affiliate-table/ViewManager';
import FilterBuilder from '@/components/affiliate-table/FilterBuilder';
import { SortPicker } from '@/components/affiliate-table/SortPicker';
import ColumnPicker from '@/components/affiliate-table/ColumnPicker';
import ImportCsvDialog from '@/components/affiliate-table/ImportCsvDialog';
import AddCreatorDialog from '@/components/affiliate-table/AddCreatorDialog';
import AssignToProjectDialog from '@/components/affiliate-table/AssignToProjectDialog';
import { CustomColumnDialog } from '@/components/affiliate-table/CustomColumnDialog';
import CommentsSidebar from '@/components/affiliate-table/CommentsSidebar';
import { FIXED_COLUMNS, DEFAULT_VISIBLE_COLUMNS } from '@/lib/affiliate-columns';
import type { AffiliateCreator, AffiliateView, AffiliateCustomColumn, ViewFilter } from '@/types/database';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import { useUserRole } from '@/hooks/useUserRole';

interface BrandOption {
  id: string;
  name: string;
}

interface ProjectOption {
  id: string;
  name: string;
  brand_id: string;
}

export default function AffiliatesPage() {
  const { isOperator } = useUserRole();
  const [affiliates, setAffiliates] = useState<AffiliateCreator[]>([]);
  const [views, setViews] = useState<AffiliateView[]>([]);
  const [customColumns, setCustomColumns] = useState<AffiliateCustomColumn[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  // Local filter/sort state (overridden when a view is active)
  const [localFilters, setLocalFilters] = useState<ViewFilter[]>([]);
  const [localSort, setLocalSort] = useState<{ column: string; direction: 'asc' | 'desc' } | null>(null);
  const [localVisibleColumns, setLocalVisibleColumns] = useState<string[]>(DEFAULT_VISIBLE_COLUMNS);

  // Dialogs
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [customColOpen, setCustomColOpen] = useState(false);

  // Comments
  const [commentTarget, setCommentTarget] = useState<{ id: string; handle: string } | null>(null);

  // Active view
  const activeView = useMemo(
    () => views.find((v) => v.id === activeViewId) || null,
    [views, activeViewId]
  );

  // Effective filters/sort/columns
  const filters = activeView?.filters || localFilters;
  const sortConfig = activeView?.sort_config || localSort;
  const visibleColumns = activeView?.visible_columns?.length
    ? activeView.visible_columns
    : localVisibleColumns;

  // Fetch data
  const fetchData = useCallback(async () => {
    try {
      const supabase = createSupabaseBrowser();

      const [affRes, viewRes, colRes, brandsRes, projectsRes] = await Promise.all([
        fetch('/api/affiliates'),
        fetch('/api/affiliates/views'),
        fetch('/api/affiliates/custom-columns').catch(() => ({ ok: false, json: () => Promise.resolve([]) })),
        supabase.from('brands').select('id, name').order('name'),
        supabase.from('projects').select('id, name, brand_id').order('name'),
      ]);

      if (affRes.ok) setAffiliates(await affRes.json());
      if (viewRes.ok) setViews(await viewRes.json());
      if (colRes.ok) {
        const cols = await colRes.json();
        if (Array.isArray(cols)) setCustomColumns(cols);
      }
      if (brandsRes.data && brandsRes.data.length > 0) {
        setBrands(brandsRes.data as BrandOption[]);
      } else {
        // Fallback: extract unique brands from affiliate data
        console.warn('Brands fetch returned empty, RLS may be blocking');
      }
      if (projectsRes.data && projectsRes.data.length > 0) {
        setProjects(projectsRes.data as ProjectOption[]);
      } else {
        console.warn('Projects fetch returned empty, RLS may be blocking');
      }
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Resolve display name for brand_id / project_id columns
  const resolveDisplayValue = useCallback((column: string, rawVal: unknown): string => {
    if (column === 'brand_id') {
      const brand = brands.find((b) => b.id === rawVal);
      return brand?.name ?? String(rawVal ?? '');
    }
    if (column === 'project_id') {
      const project = projects.find((p) => p.id === rawVal);
      return project?.name ?? String(rawVal ?? '');
    }
    return String(rawVal ?? '');
  }, [brands, projects]);

  // Apply client-side filters
  const filteredData = useMemo(() => {
    let result = [...affiliates];

    // Apply search
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (a) =>
          a.handle?.toLowerCase().includes(q) ||
          a.email?.toLowerCase().includes(q) ||
          a.project?.toLowerCase().includes(q) ||
          a.category?.toLowerCase().includes(q)
      );
    }

    // Apply filters
    for (const filter of filters) {
      result = result.filter((row) => {
        const rawVal = (row as unknown as Record<string, unknown>)[filter.column];
        // For brand_id / project_id, compare against display names
        const val = (filter.column === 'brand_id' || filter.column === 'project_id')
          ? resolveDisplayValue(filter.column, rawVal)
          : rawVal;
        const strVal = String(val ?? '').toLowerCase();
        const filterVal = String(filter.value ?? '').toLowerCase();
        switch (filter.operator) {
          case 'eq': return strVal === filterVal;
          case 'neq': return strVal !== filterVal;
          case 'contains': return strVal.includes(filterVal);
          case 'not_contains': return !strVal.includes(filterVal);
          case 'gt': return Number(val) > Number(filter.value);
          case 'gte': return Number(val) >= Number(filter.value);
          case 'lt': return Number(val) < Number(filter.value);
          case 'lte': return Number(val) <= Number(filter.value);
          case 'is_empty': return rawVal === null || rawVal === undefined || rawVal === '';
          case 'is_not_empty': return rawVal !== null && rawVal !== undefined && rawVal !== '';
          default: return true;
        }
      });
    }

    // Apply sort
    if (sortConfig?.column) {
      result.sort((a, b) => {
        const aVal = (a as unknown as Record<string, unknown>)[sortConfig.column];
        const bVal = (b as unknown as Record<string, unknown>)[sortConfig.column];
        const aNum = Number(aVal);
        const bNum = Number(bVal);
        const isNum = !isNaN(aNum) && !isNaN(bNum) && aVal !== null && bVal !== null;

        let cmp = 0;
        if (isNum) cmp = aNum - bNum;
        else cmp = String(aVal ?? '').localeCompare(String(bVal ?? ''));

        return sortConfig.direction === 'desc' ? -cmp : cmp;
      });
    }

    return result;
  }, [affiliates, search, filters, sortConfig, resolveDisplayValue]);

  // Handlers
  const handleCellUpdate = useCallback(async (id: string, key: string, value: unknown) => {
    // Handle bulk replace from confirm dialog (already sent to API)
    if (key === '_replace') {
      setAffiliates((prev) => prev.map((a) => (a.id === id ? (value as any) : a)));
      setToast('✅ Creator added to project');
      setTimeout(() => setToast(null), 3000);
      return;
    }

    // Block operator from setting status to Confirmed
    if (isOperator && key === 'status' && value === 'Confirmed') {
      setToast('❌ Operator cannot set status to Confirmed');
      setTimeout(() => setToast(null), 3000);
      return;
    }

    // Optimistic update
    setAffiliates((prev) =>
      prev.map((a) => (a.id === id ? { ...a, [key]: value } : a))
    );

    try {
      const res = await fetch('/api/affiliates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, [key]: value }),
      });
      if (res.ok) {
        const updated = await res.json();
        setAffiliates((prev) => prev.map((a) => (a.id === id ? updated : a)));

        // Show success toast when status changed to Confirmed
        if (key === 'status' && value === 'Confirmed') {
          setToast('✅ Creator added to project');
          setTimeout(() => setToast(null), 3000);
        }
      } else {
        // Revert optimistic update
        const err = await res.json();
        setAffiliates((prev) =>
          prev.map((a) => (a.id === id ? { ...a, [key]: undefined } : a))
        );
        // Refetch to get correct state
        fetchData();
        setToast(`❌ ${err.error || 'Update failed'}`);
        setTimeout(() => setToast(null), 3000);
      }
    } catch (err) {
      console.error('Failed to update:', err);
    }
  }, [fetchData]);

  const handleImport = useCallback(async (rows: Record<string, string>[]) => {
    try {
      const res = await fetch('/api/affiliates/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      if (res.ok) {
        const result = await res.json();
        alert(`${result.imported} creators imported successfully!`);
        fetchData();
      } else {
        const err = await res.json();
        alert(`Import failed: ${err.error}`);
      }
    } catch (err) {
      console.error('Import error:', err);
    }
    setImportOpen(false);
  }, [fetchData]);

  const handleAddCreator = useCallback(async (data: Record<string, unknown>) => {
    try {
      const res = await fetch('/api/affiliates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        const created = await res.json();
        setAffiliates((prev) => [created, ...prev]);
      }
    } catch (err) {
      console.error('Add error:', err);
    }
    setAddOpen(false);
  }, []);

  const handleAssign = useCallback(async (projectId: string) => {
    try {
      const res = await fetch('/api/affiliates/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          affiliate_creator_ids: Array.from(selectedIds),
          project_id: projectId,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        const assigned = result.results.filter((r: { status: string }) => r.status === 'assigned').length;
        alert(`${assigned} creator(s) assigned to project!`);
        setSelectedIds(new Set());
      }
    } catch (err) {
      console.error('Assign error:', err);
    }
    setAssignOpen(false);
  }, [selectedIds]);

  const handleDeleteSelected = useCallback(async () => {
    if (!confirm(`Delete ${selectedIds.size} creator(s)?`)) return;
    try {
      const res = await fetch('/api/affiliates', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      if (res.ok) {
        setAffiliates((prev) => prev.filter((a) => !selectedIds.has(a.id)));
        setSelectedIds(new Set());
      }
    } catch (err) {
      console.error('Delete error:', err);
    }
  }, [selectedIds]);

  const handleCreateView = useCallback(async (name: string) => {
    try {
      const res = await fetch('/api/affiliates/views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          filters: localFilters,
          visible_columns: localVisibleColumns,
          sort_config: localSort || { column: 'created_at', direction: 'desc' },
        }),
      });
      if (res.ok) {
        const view = await res.json();
        setViews((prev) => [...prev, view]);
        setActiveViewId(view.id);
      }
    } catch (err) {
      console.error('Create view error:', err);
    }
  }, [localFilters, localVisibleColumns, localSort]);

  const handleDeleteView = useCallback(async (viewId: string) => {
    try {
      await fetch('/api/affiliates/views', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: viewId }),
      });
      setViews((prev) => prev.filter((v) => v.id !== viewId));
      if (activeViewId === viewId) setActiveViewId(null);
    } catch (err) {
      console.error('Delete view error:', err);
    }
  }, [activeViewId]);

  const handleRenameView = useCallback(async (viewId: string, name: string) => {
    try {
      const res = await fetch('/api/affiliates/views', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: viewId, name }),
      });
      if (res.ok) {
        const updated = await res.json();
        setViews((prev) => prev.map((v) => (v.id === viewId ? updated : v)));
      }
    } catch (err) {
      console.error('Rename view error:', err);
    }
  }, []);

  const handleCopyShareLink = useCallback((slug: string) => {
    const url = `${window.location.origin}/v/${slug}`;
    navigator.clipboard.writeText(url);
    alert('Share link copied!');
  }, []);

  const handleUpdateViewFilters = useCallback(async (newFilters: ViewFilter[]) => {
    if (activeView) {
      try {
        const res = await fetch('/api/affiliates/views', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: activeView.id, filters: newFilters }),
        });
        if (res.ok) {
          const updated = await res.json();
          setViews((prev) => prev.map((v) => (v.id === activeView.id ? updated : v)));
        }
      } catch (err) {
        console.error('Update filters error:', err);
      }
    } else {
      setLocalFilters(newFilters);
    }
  }, [activeView]);

  const handleUpdateSort = useCallback(async (newSort: { column: string; direction: 'asc' | 'desc' } | null) => {
    if (activeView) {
      // Optimistic update: apply sort immediately to avoid flicker
      setViews((prev) =>
        prev.map((v) =>
          v.id === activeView.id
            ? { ...v, sort_config: newSort || { column: 'created_at', direction: 'desc' as const } }
            : v
        )
      );
      if (newSort) {
        try {
          const res = await fetch('/api/affiliates/views', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: activeView.id, sort_config: newSort }),
          });
          if (res.ok) {
            const updated = await res.json();
            setViews((prev) => prev.map((v) => (v.id === activeView.id ? updated : v)));
          }
        } catch (err) {
          console.error('Update sort error:', err);
        }
      }
    } else {
      setLocalSort(newSort);
    }
  }, [activeView]);

  const handleUpdateVisibleColumns = useCallback(async (cols: string[]) => {
    if (activeView) {
      try {
        const res = await fetch('/api/affiliates/views', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: activeView.id, visible_columns: cols }),
        });
        if (res.ok) {
          const updated = await res.json();
          setViews((prev) => prev.map((v) => (v.id === activeView.id ? updated : v)));
        }
      } catch (err) {
        console.error('Update columns error:', err);
      }
    } else {
      setLocalVisibleColumns(cols);
    }
  }, [activeView]);

  const handleDuplicate = useCallback(async (row: AffiliateCreator) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, ...rest } = row as AffiliateCreator & { id: string };
    const copy = { ...rest, brand_id: null, project_id: null };
    // Remove timestamp fields if present
    delete (copy as Record<string, unknown>).created_at;
    delete (copy as Record<string, unknown>).updated_at;
    try {
      const res = await fetch('/api/affiliates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(copy),
      });
      if (res.ok) {
        const created = await res.json();
        setAffiliates((prev) => [created, ...prev]);
        setToast('✅ 복제되었습니다. 브랜드/프로젝트를 배정해주세요');
        setTimeout(() => setToast(null), 3000);
      }
    } catch (err) {
      console.error('Duplicate failed:', err);
    }
  }, []);

  const handleAddCustomColumn = useCallback(async (column: {
    name: string;
    key: string;
    column_type: string;
    options: { value: string; color?: string }[];
  }) => {
    try {
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/affiliate_custom_columns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'return=representation',
        },
        body: JSON.stringify(column),
      });
      if (res.ok) {
        const created = await res.json();
        setCustomColumns((prev) => [...prev, created[0] || created]);
      }
    } catch (err) {
      console.error('Add custom column error:', err);
    }
  }, []);

  const allColumnDefs = [
    ...FIXED_COLUMNS,
    ...customColumns.map((c) => ({
      key: c.key,
      label: c.name,
      type: c.column_type as 'text' | 'number' | 'select' | 'multi_select' | 'link' | 'email',
      editable: true,
      options: c.options,
      width: 140,
    })),
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Affiliates</h1>
          <p className="text-sm text-muted-foreground">
            {affiliates.length} creators total &middot; {filteredData.length} shown
          </p>
        </div>
      </div>

      {/* View Manager */}
      <ViewManager
        views={views}
        activeViewId={activeViewId}
        onViewChange={setActiveViewId}
        onCreateView={handleCreateView}
        onDeleteView={handleDeleteView}
        onRenameView={handleRenameView}
        onCopyShareLink={handleCopyShareLink}
      />

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search handle, email, project..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-64 pl-8 text-sm"
          />
        </div>

        <FilterBuilder
          filters={filters}
          columns={allColumnDefs}
          onChange={handleUpdateViewFilters}
          brands={brands}
          projects={projects}
        />

        <SortPicker
          columns={allColumnDefs}
          sortConfig={sortConfig}
          onChange={handleUpdateSort}
        />

        <ColumnPicker
          allColumns={allColumnDefs}
          visibleColumns={visibleColumns}
          onChange={handleUpdateVisibleColumns}
        />

        <div className="h-5 w-px bg-border" />

        <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setImportOpen(true)}>
          <Upload className="h-3.5 w-3.5" /> Import CSV
        </Button>

        <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setAddOpen(true)}>
          <UserPlus className="h-3.5 w-3.5" /> Add
        </Button>

        <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setCustomColOpen(true)}>
          <Columns3 className="h-3.5 w-3.5" /> Add Column
        </Button>

        {selectedIds.size > 0 && (
          <>
            <div className="h-5 w-px bg-border" />
            <Button size="sm" className="h-8 gap-1.5" onClick={() => setAssignOpen(true)}>
              <FolderInput className="h-3.5 w-3.5" /> Assign ({selectedIds.size})
            </Button>
            {!isOperator && (
              <Button
                variant="destructive"
                size="sm"
                className="h-8"
                onClick={handleDeleteSelected}
              >
                Delete ({selectedIds.size})
              </Button>
            )}
          </>
        )}
      </div>

      {/* Table */}
      <AffiliateTable
        data={filteredData}
        columns={FIXED_COLUMNS}
        customColumns={customColumns}
        visibleColumns={visibleColumns}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        onCellUpdate={handleCellUpdate}
        onOpenComments={(id, handle) => setCommentTarget({ id, handle })}
        onDuplicate={handleDuplicate}
        brands={brands}
        projects={projects}
        onStatusChangeBlocked={(msg) => {
          setToast(msg);
          setTimeout(() => setToast(null), 3000);
        }}
      />

      {/* Dialogs */}
      <ImportCsvDialog open={importOpen} onOpenChange={setImportOpen} onImport={handleImport} />
      <AddCreatorDialog open={addOpen} onOpenChange={setAddOpen} onAdd={handleAddCreator} brands={brands} projects={projects} defaultFilters={activeView?.filters} />
      <AssignToProjectDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        selectedCount={selectedIds.size}
        onAssign={handleAssign}
      />
      <CustomColumnDialog open={customColOpen} onOpenChange={setCustomColOpen} onAdd={handleAddCustomColumn} />

      {/* Comments Sidebar */}
      {commentTarget && (
        <CommentsSidebar
          affiliateCreatorId={commentTarget.id}
          handle={commentTarget.handle}
          onClose={() => setCommentTarget(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg border bg-background px-4 py-3 text-sm shadow-lg animate-in fade-in slide-in-from-bottom-2">
          {toast}
        </div>
      )}
    </div>
  );
}
