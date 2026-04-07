'use client';

import { useState, useEffect } from 'react';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import { Brand, Project } from '@/types/database';
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
import { Loader2, FolderOpen } from 'lucide-react';

interface AssignToProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onAssign: (projectId: string) => void;
}

export default function AssignToProjectDialog({
  open,
  onOpenChange,
  selectedCount,
  onAssign,
}: AssignToProjectDialogProps) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [loadingBrands, setLoadingBrands] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);

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
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  }

  function handleAssign() {
    if (selectedProjectId) {
      onAssign(selectedProjectId);
      handleOpenChange(false);
    }
  }

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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAssign} disabled={!selectedProjectId}>
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
