'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FIXED_COLUMNS } from '@/lib/affiliate-columns';
import { UserPlus } from 'lucide-react';

interface BrandOption {
  id: string;
  name: string;
}

interface ProjectOption {
  id: string;
  name: string;
  brand_id: string;
}

interface ViewFilter {
  column: string;
  operator: string;
  value?: string | number;
}

interface AddCreatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (data: Record<string, unknown>) => void;
  brands: BrandOption[];
  projects: ProjectOption[];
  defaultFilters?: ViewFilter[];
}

const STATUS_OPTIONS = FIXED_COLUMNS.find((c) => c.key === 'status')?.options || [];
const CONTACT_TYPE_OPTIONS = FIXED_COLUMNS.find((c) => c.key === 'contact_type')?.options || [];

export default function AddCreatorDialog({
  open,
  onOpenChange,
  onAdd,
  brands,
  projects,
  defaultFilters,
}: AddCreatorDialogProps) {
  const [handle, setHandle] = useState('');
  const [email, setEmail] = useState('');
  const [brandId, setBrandId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [contactType, setContactType] = useState('');
  const [status, setStatus] = useState('');
  const [followers, setFollowers] = useState('');
  const [avgView, setAvgView] = useState('');
  const [gmv, setGmv] = useState('');
  const [plannedVideoCount, setPlannedVideoCount] = useState('');
  const [contractAmount, setContractAmount] = useState('');
  const [thread, setThread] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [priceComment, setPriceComment] = useState('');
  const [error, setError] = useState('');

  const filteredProjects = useMemo(
    () => (brandId ? projects.filter((p) => p.brand_id === brandId) : []),
    [brandId, projects]
  );

  function reset() {
    setHandle('');
    setEmail('');
    setBrandId('');
    setProjectId('');
    setContactType('');
    setStatus('');
    setFollowers('');
    setAvgView('');
    setGmv('');
    setPlannedVideoCount('');
    setContractAmount('');
    setThread('');
    setMinPrice('');
    setMaxPrice('');
    setPriceComment('');
    setError('');
  }

  // Pre-fill from view filters when dialog opens
  useEffect(() => {
    if (!open || !defaultFilters?.length) return;

    let newBrandId = '';
    let newProjectId = '';
    let newStatus = '';

    for (const f of defaultFilters) {
      if (f.operator !== 'eq' || !f.value) continue;
      const val = String(f.value);
      if (f.column === 'brand_id') {
        const brand = brands.find(b => b.id === val || b.name === val);
        if (brand) newBrandId = brand.id;
      } else if (f.column === 'project_id') {
        const proj = projects.find(p => p.id === val || p.name === val);
        if (proj) {
          newProjectId = proj.id;
          if (!newBrandId) newBrandId = proj.brand_id;
        }
      } else if (f.column === 'status') {
        newStatus = val;
      }
    }

    if (newBrandId) setBrandId(newBrandId);
    if (newProjectId) setProjectId(newProjectId);
    if (newStatus) setStatus(newStatus);
  }, [open, defaultFilters, brands, projects]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  }

  function handleBrandChange(newBrandId: string) {
    setBrandId(newBrandId);
    setProjectId(''); // reset project when brand changes
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!handle.trim()) {
      setError('Handle is required');
      return;
    }

    const data: Record<string, unknown> = {
      handle: handle.trim(),
    };

    if (email.trim()) data.email = email.trim();
    if (brandId) data.brand_id = brandId;
    if (projectId) data.project_id = projectId;
    if (contactType) data.contact_type = contactType;
    if (status) data.status = status;
    if (followers) data.followers = parseFloat(followers);
    if (avgView) data.avg_view = parseFloat(avgView);
    if (gmv) data.gmv = parseFloat(gmv);
    if (plannedVideoCount) data.planned_video_count = parseInt(plannedVideoCount, 10);
    if (contractAmount) data.contract_amount = parseFloat(contractAmount);
    if (thread.trim()) data.thread = thread.trim();
    if (minPrice) data.min_price = parseFloat(minPrice);
    if (maxPrice) data.max_price = parseFloat(maxPrice);
    if (priceComment.trim()) data.price_comment = priceComment.trim();

    // Set project text from selected project name for backward compatibility
    if (projectId) {
      const proj = projects.find((p) => p.id === projectId);
      if (proj) data.project = proj.name;
    }

    onAdd(data);
    handleOpenChange(false);
  }

  const selectClass =
    'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Add Creator
          </DialogTitle>
          <DialogDescription>
            Manually add a new affiliate creator to the database.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Handle */}
          <div className="space-y-2">
            <Label htmlFor="handle">
              Handle <span className="text-destructive">*</span>
            </Label>
            <Input
              id="handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="@creator_handle"
            />
          </div>

          {/* Email */}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="creator@example.com"
            />
          </div>

          {/* Brand & Project */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="brand_id">Brand</Label>
              <select
                id="brand_id"
                value={brandId}
                onChange={(e) => handleBrandChange(e.target.value)}
                className={selectClass}
              >
                <option value="">Select...</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="project_id">Project</Label>
              <select
                id="project_id"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className={selectClass}
                disabled={!brandId}
              >
                <option value="">{brandId ? 'Select...' : 'Select brand first'}</option>
                {filteredProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Contact Type & Status */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="contact_type">Contact Type</Label>
              <select
                id="contact_type"
                value={contactType}
                onChange={(e) => setContactType(e.target.value)}
                className={selectClass}
              >
                <option value="">Select...</option>
                {CONTACT_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.value}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <select
                id="status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className={selectClass}
              >
                <option value="">Select...</option>
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.value}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Numeric fields */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="followers">Followers</Label>
              <Input
                id="followers"
                type="number"
                value={followers}
                onChange={(e) => setFollowers(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="avg_view">Avg. View</Label>
              <Input
                id="avg_view"
                type="number"
                value={avgView}
                onChange={(e) => setAvgView(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          {/* GMV */}
          <div className="space-y-2">
            <Label htmlFor="gmv">GMV ($)</Label>
            <Input
              id="gmv"
              type="number"
              value={gmv}
              onChange={(e) => setGmv(e.target.value)}
              placeholder="0"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="planned_video_count">Planned Videos</Label>
              <Input
                id="planned_video_count"
                type="number"
                value={plannedVideoCount}
                onChange={(e) => setPlannedVideoCount(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contract_amount">Contract ($)</Label>
              <Input
                id="contract_amount"
                type="number"
                value={contractAmount}
                onChange={(e) => setContractAmount(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          {/* Min Price & Max Price */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="min_price">Min Price ($)</Label>
              <Input
                id="min_price"
                type="number"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="max_price">Max Price ($)</Label>
              <Input
                id="max_price"
                type="number"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          {/* Price Comment */}
          <div className="space-y-2">
            <Label htmlFor="price_comment">Price Comment</Label>
            <Input
              id="price_comment"
              value={priceComment}
              onChange={(e) => setPriceComment(e.target.value)}
              placeholder="Notes on pricing..."
            />
          </div>

          {/* Thread */}
          <div className="space-y-2">
            <Label htmlFor="thread">Thread Link</Label>
            <Input
              id="thread"
              type="url"
              value={thread}
              onChange={(e) => setThread(e.target.value)}
              placeholder="https://..."
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Add Creator</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
