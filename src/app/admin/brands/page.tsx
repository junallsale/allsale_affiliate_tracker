'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, ChevronRight, Loader2, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import { Brand } from '@/types/database';
import { generateSlug } from '@/lib/utils';
import { useUserRole } from '@/hooks/useUserRole';
import { isDemoBrandId } from '@/lib/demo';

interface BrandWithProjectCount extends Brand {
  project_count: number;
}

export default function BrandsPage() {
  const [brands, setBrands] = useState<BrandWithProjectCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [brandName, setBrandName] = useState('');
  const [creating, setCreating] = useState(false);
  const supabase = createSupabaseBrowser();
  const { isBrandViewer, isOperator } = useUserRole();

  useEffect(() => {
    fetchBrands();
  }, []);

  const fetchBrands = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('brands')
        .select(
          `
          *,
          projects:projects(count)
        `
        )
        .order('created_at', { ascending: false });

      if (error) throw error;

      const brandsWithCounts = (data || [])
        .filter((brand: any) => !isDemoBrandId(brand.id))
        .map((brand: any) => ({
          ...brand,
          project_count: brand.projects?.[0]?.count || 0,
        }));

      setBrands(brandsWithCounts);
    } catch (error) {
      console.error('Error fetching brands:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBrand = async () => {
    if (!brandName.trim()) return;

    try {
      setCreating(true);
      const slug = generateSlug();

      const { error } = await supabase.from('brands').insert([
        {
          name: brandName,
          slug,
        },
      ]);

      if (error) throw error;

      setBrandName('');
      setDialogOpen(false);
      fetchBrands();
    } catch (error) {
      console.error('Error creating brand:', error);
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Brands</h1>
          <p className="text-muted-foreground mt-2">
            Manage your brand portfolios
          </p>
        </div>
        {!isBrandViewer && !isOperator && <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Brand
          </Button>

          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Brand</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="brand-name">Brand Name</Label>
                <Input
                  id="brand-name"
                  placeholder="Enter brand name"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleCreateBrand();
                    }
                  }}
                  disabled={creating}
                />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button
                onClick={handleCreateBrand}
                disabled={!brandName.trim() || creating}
              >
                {creating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Brand'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>}
      </div>

      {/* Brands Grid or Empty State */}
      {brands.length === 0 ? (
        <div className="flex items-center justify-center min-h-[400px]">
          <Card className="w-full max-w-sm">
            <CardContent className="flex flex-col items-center justify-center pt-8 text-center space-y-4">
              <div className="rounded-full bg-muted p-3">
                <Building2 className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="space-y-2">
                <h3 className="font-semibold text-lg">No brands yet</h3>
                <p className="text-sm text-muted-foreground">
                  Create your first brand to get started
                </p>
              </div>
              <Button
                onClick={() => setDialogOpen(true)}
                className="mt-2"
              >
                <Plus className="mr-2 h-4 w-4" />
                Create Brand
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {brands.map((brand) => (
            <Link key={brand.id} href={`/admin/brands/${brand.slug}`}>
              <Card className="group cursor-pointer transition-all hover:shadow-lg hover:border-primary/50">
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                  <CardTitle className="text-lg group-hover:text-primary transition-colors">
                    {brand.name}
                  </CardTitle>
                  <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors opacity-0 group-hover:opacity-100 -mr-2" />
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      {brand.project_count}
                      {brand.project_count === 1 ? ' project' : ' projects'}
                    </Badge>
                  </div>
                  {brand.created_at && (
                    <p className="text-xs text-muted-foreground">
                      Created{' '}
                      {new Date(brand.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
