'use client';

import { useState, useEffect } from 'react';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import { Brand, Project, AssignResult } from '@/types/database';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, FolderOpen, AlertTriangle } from 'lucide-react';

interface AssignToProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onAssign: (projectId: string, reactivateIds?: string[]) => Promise<AssignResult | null>;
  onDone: () => void;
}

export default function AssignToProjectDialog({
  open,
  onOpenChange,
  selectedCount,
  onAssign,
  onDone,
}: AssignToProjectDialogProps) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [loadingBrands, setLoadingBrands] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AssignResult | null>(null);

  // Fetch brands when dialog opens
  useEffect(() => {
    if (!open) return;

    async function fetchBrands() {
      setLoadingBrands(true);
      try {
        const supabase = createSupabaseBrowser();
        const { data, error } = await supabase
          .from('brands')
          .select('*')
          .order('name', { ascending: true });

        if (error) {
          console.error('Failed to fetch brands:', error.message);
          return;
        }
        setBrands(data || []);
      } catch (err) {
        console.error('Failed to fetch brands:', err);
      } finally {
        setLoadingBrands(false);
      }
    }

    fetchBrands();
  }, [open]);

  // Fetch projects when brand changes
  useEffect(() => {
    if (!selectedBrandId) {
      setProjects([]);
      setSelectedProjectId('');
      return;
    }

    async function fetchProjects() {
      setLoadingProjects(true);
      try {
        const supabase = createSupabaseBrowser();
        const { data, error } = await supabase
          .from('projects')
          .select('*')
          .eq('brand_id', selectedBrandId)
          .order('name', { ascending: true });

        if (error) {
          console.error('Failed to fetch projects:', error.message);
          return;
        }
        setProjects(data || []);
      } catch (err) {
        console.error('Failed to fetch projects:', err);
      } finally {
        setLoadingProjects(false);
      }
    }

    fetchProjects();
  }, [selectedBrandId]);

  function reset() {
    setSelectedBrandId('');
    setSelectedProjectId('');
    setProjects([]);
    setResult(null);
    setSubmitting(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  }

  async function handleAssign() {
    if (!selectedProjectId || submitting) return;
    setSubmitting(true);
    const r = await onAssign(selectedProjectId);
    setResult(r);
    setSubmitting(false);
  }

  async function handleRestore(ids: string[]) {
    if (!selectedProjectId || submitting || ids.length === 0) return;
    setSubmitting(true);
    const r = await onAssign(selectedProjectId, ids);
    setResult(r);
    setSubmitting(false);
  }

  function handleDone() {
    reset();
    onDone();
  }

  const deletedRows = (result?.results || []).filter(r => r.status === 'deleted_in_project');
  const errorRows = (result?.results || []).filter(r => r.error);
  const okCount = (result?.results || []).filter(r => r.status === 'assigned' || r.status === 'reactivated').length;
  const alreadyCount = (result?.results || []).filter(r => r.status === 'already_assigned').length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            Assign to Project
          </DialogTitle>
          <DialogDescription>
            Assign {selectedCount} creator{selectedCount !== 1 ? 's' : ''} to a
            project.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Brand select */}
          <div className="space-y-2">
            <Label htmlFor="brand">Brand</Label>
            {loadingBrands ? (
              <div className="flex items-center gap-2 h-10 px-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading brands...
              </div>
            ) : (
              <select
                id="brand"
                value={selectedBrandId}
                onChange={(e) => {
                  setSelectedBrandId(e.target.value);
                  setSelectedProjectId('');
                }}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="">Select a brand...</option>
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Project select */}
          <div className="space-y-2">
            <Label htmlFor="project">Project</Label>
            {loadingProjects ? (
              <div className="flex items-center gap-2 h-10 px-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading projects...
              </div>
            ) : (
              <select
                id="project"
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                disabled={!selectedBrandId}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">
                  {selectedBrandId
                    ? projects.length === 0
                      ? 'No projects found'
                      : 'Select a project...'
                    : 'Select a brand first'}
                </option>
                {projects.map((proj) => (
                  <option key={proj.id} value={proj.id}>
                    {proj.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Result breakdown */}
          {result && (
            <div className="space-y-2 rounded-md border p-3 text-sm">
              <p className="text-muted-foreground">
                {okCount > 0 && <span className="text-emerald-600 font-medium">{okCount} assigned</span>}
                {okCount > 0 && alreadyCount > 0 && ' · '}
                {alreadyCount > 0 && <span>{alreadyCount} already in project</span>}
                {okCount === 0 && alreadyCount === 0 && deletedRows.length === 0 && errorRows.length === 0 && 'No changes'}
              </p>

              {deletedRows.length > 0 && (
                <div className="rounded-md border border-red-200 bg-red-50 p-2.5 space-y-2">
                  <div className="flex items-start gap-1.5 text-red-700">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>
                      {deletedRows.length} creator{deletedRows.length !== 1 ? 's are' : ' is'} deleted in this project:{' '}
                      <span className="font-mono">{deletedRows.map(r => `@${r.handle}`).join(', ')}</span>
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={submitting}
                    onClick={() => handleRestore(deletedRows.map(r => r.affiliate_creator_id))}
                  >
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                    Restore &amp; assign {deletedRows.length}
                  </Button>
                </div>
              )}

              {errorRows.length > 0 && (
                <div className="text-red-600">
                  {errorRows.map(r => (
                    <p key={r.affiliate_creator_id}>@{r.handle}: {r.error}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {result ? (
            <Button onClick={handleDone}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleAssign} disabled={!selectedProjectId || submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                Assign
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
