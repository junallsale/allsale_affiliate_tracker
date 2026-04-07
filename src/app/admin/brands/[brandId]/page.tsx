'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Plus,
  Loader2,
  Calendar,
  Users,
  Video,
  Package,
  Pencil,
  Trash2,
  MoreVertical,
  ExternalLink,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

import { createSupabaseBrowser } from '@/lib/supabase-browser';
import { useUserRole } from '@/hooks/useUserRole';
import type { Brand, Project, Product } from '@/types/database';
import { generateSlug, getProjectStatusBadge } from '@/lib/utils';

interface ProjectWithStats extends Project {
  totalVideosAssigned: number;
  totalVideosUploaded: number;
  completedCreators: number;
  totalCreators: number;
}

export default function BrandDetailPage() {
  const params = useParams();
  const brandId = params.brandId as string;
  const supabase = createSupabaseBrowser();
  const { isBrandViewer, isOperator } = useUserRole();
  const canCreate = !isBrandViewer && !isOperator;
  const canDelete = !isBrandViewer && !isOperator;

  const [brand, setBrand] = useState<Brand | null>(null);
  const [projects, setProjects] = useState<ProjectWithStats[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [productDialogOpen, setProductDialogOpen] = useState(false);

  const [projectFormData, setProjectFormData] = useState({
    name: '',
    description: '',
    start_date: '',
    end_date: '',
    submission_deadline: '',
    budget: '',
  });

  const [productFormData, setProductFormData] = useState({
    name: '',
    thumbnail_url: '',
    content_guide_url: '',
    product_link: '',
  });

  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editProductDialogOpen, setEditProductDialogOpen] = useState(false);
  const [editProductFormData, setEditProductFormData] = useState({
    name: '',
    thumbnail_url: '',
    content_guide_url: '',
    product_link: '',
  });

  const [submitting, setSubmitting] = useState(false);

  // Fetch brand, projects, and products
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);

        // Fetch brand by slug (brandId param is actually slug)
        const { data: brandData, error: brandError } = await supabase
          .from('brands')
          .select('*')
          .eq('slug', brandId)
          .single();

        if (brandError) throw brandError;
        setBrand(brandData);

        const realBrandId = brandData.id;

        // Fetch projects with stats via project_creators
        const { data: projectsData, error: projectsError } = await supabase
          .from('projects')
          .select('*')
          .eq('brand_id', realBrandId)
          .order('created_at', { ascending: false });

        if (projectsError) throw projectsError;

        const projectsWithStats: ProjectWithStats[] = await Promise.all(
          (projectsData || []).map(async (project: any) => {
            const { data: pcData } = await supabase
              .from('project_creators')
              .select('assigned_video_count, videos(id)')
              .eq('project_id', project.id);

            const pcs = pcData || [];
            const totalVideosAssigned = pcs.reduce((sum: number, pc: any) => sum + (pc.assigned_video_count || 0), 0);
            const totalVideosUploaded = pcs.reduce((sum: number, pc: any) => sum + (pc.videos?.length || 0), 0);
            const completedCreators = pcs.filter((pc: any) => (pc.videos?.length || 0) >= (pc.assigned_video_count || 0) && (pc.assigned_video_count || 0) > 0).length;

            return {
              ...project,
              totalVideosAssigned,
              totalVideosUploaded,
              completedCreators,
              totalCreators: pcs.length,
            };
          })
        );

        setProjects(projectsWithStats);

        // Fetch products
        const { data: productsData, error: productsError } = await supabase
          .from('products')
          .select('*')
          .eq('brand_id', realBrandId);

        if (productsError) throw productsError;
        setProducts(productsData || []);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    if (brandId) {
      fetchData();
    }
  }, [brandId, supabase]);

  // Handle create project
  const handleCreateProject = async () => {
    if (!projectFormData.name.trim() || !brand) return;

    try {
      setSubmitting(true);

      const { error } = await supabase.from('projects').insert({
        brand_id: brand.id,
        name: projectFormData.name,
        description: projectFormData.description || null,
        slug: generateSlug(),
        start_date: projectFormData.start_date || null,
        end_date: projectFormData.end_date || null,
        submission_deadline: projectFormData.submission_deadline || null,
        budget: projectFormData.budget ? parseFloat(projectFormData.budget) : 0,
        status: 'active',
      });

      if (error) throw error;

      // Refresh projects
      const { data: projectsData } = await supabase
        .from('projects')
        .select('*')
        .eq('brand_id', brand.id)
        .order('created_at', { ascending: false });

      if (projectsData) {
        const projectsWithStats: ProjectWithStats[] = await Promise.all(
          projectsData.map(async (project: any) => {
            const { data: pcData } = await supabase
              .from('project_creators')
              .select('assigned_video_count, videos(id)')
              .eq('project_id', project.id);

            const pcs = pcData || [];
            const totalVideosAssigned = pcs.reduce((sum: number, pc: any) => sum + (pc.assigned_video_count || 0), 0);
            const totalVideosUploaded = pcs.reduce((sum: number, pc: any) => sum + (pc.videos?.length || 0), 0);
            const completedCreators = pcs.filter((pc: any) => (pc.videos?.length || 0) >= (pc.assigned_video_count || 0) && (pc.assigned_video_count || 0) > 0).length;

            return {
              ...project,
              totalVideosAssigned,
              totalVideosUploaded,
              completedCreators,
              totalCreators: pcs.length,
            };
          })
        );
        setProjects(projectsWithStats);
      }

      setProjectFormData({
        name: '',
        description: '',
        start_date: '',
        end_date: '',
        submission_deadline: '',
        budget: '',
      });
      setProjectDialogOpen(false);
    } catch (error) {
      console.error('Error creating project:', error);
    } finally {
      setSubmitting(false);
    }
  };

  // Handle create product
  const handleCreateProduct = async () => {
    if (!productFormData.name.trim() || !brand) return;

    try {
      setSubmitting(true);

      const { error } = await supabase.from('products').insert({
        brand_id: brand.id,
        name: productFormData.name,
        thumbnail_url: productFormData.thumbnail_url || null,
        content_guide_url: productFormData.content_guide_url || null,
        product_link: productFormData.product_link || null,
      });

      if (error) throw error;

      await refreshProducts();

      setProductFormData({
        name: '',
        thumbnail_url: '',
        content_guide_url: '',
        product_link: '',
      });
      setProductDialogOpen(false);
    } catch (error) {
      console.error('Error creating product:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const refreshProducts = async () => {
    if (!brand) return;
    const { data } = await supabase
      .from('products')
      .select('*')
      .eq('brand_id', brand.id);
    if (data) setProducts(data);
  };

  const handleEditProduct = (product: Product) => {
    setEditingProduct(product);
    setEditProductFormData({
      name: product.name,
      thumbnail_url: product.thumbnail_url || '',
      content_guide_url: product.content_guide_url || '',
      product_link: product.product_link || '',
    });
    setEditProductDialogOpen(true);
  };

  const handleUpdateProduct = async () => {
    if (!editingProduct || !editProductFormData.name.trim()) return;

    try {
      setSubmitting(true);
      const { error } = await supabase
        .from('products')
        .update({
          name: editProductFormData.name,
          thumbnail_url: editProductFormData.thumbnail_url || null,
          content_guide_url: editProductFormData.content_guide_url || null,
          product_link: editProductFormData.product_link || null,
        })
        .eq('id', editingProduct.id);

      if (error) throw error;

      await refreshProducts();
      setEditProductDialogOpen(false);
      setEditingProduct(null);
    } catch (error) {
      console.error('Error updating product:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteProduct = async (productId: string, productName: string) => {
    if (!confirm(`"${productName}" 제품을 삭제하시겠습니까?`)) return;

    try {
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', productId);

      if (error) throw error;
      await refreshProducts();
    } catch (error) {
      console.error('Error deleting product:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!brand) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Brand not found</p>
      </div>
    );
  }

  const videoProgress =
    projects.length > 0
      ? Math.round(
          (projects.reduce((sum, p) => sum + p.totalVideosUploaded, 0) /
            projects.reduce((sum, p) => sum + p.totalVideosAssigned, 0)) *
            100
        )
      : 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="container py-8">
        {/* Header */}
        <div className="mb-8 flex items-center gap-4">
          <Link href="/admin/brands">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-3xl font-bold tracking-tight">{brand.name}</h1>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="projects" className="w-full">
          <TabsList>
            <TabsTrigger value="projects">Projects</TabsTrigger>
            <TabsTrigger value="products">Products</TabsTrigger>
          </TabsList>

          {/* Projects Tab */}
          <TabsContent value="projects" className="mt-6">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Projects</h2>
                <p className="text-sm text-muted-foreground">
                  {projects.length}{' '}
                  {projects.length === 1 ? 'project' : 'projects'}
                </p>
              </div>
              {canCreate && (
                <Button
                  onClick={() => setProjectDialogOpen(true)}
                  className="gap-2"
                >
                  <Plus className="h-4 w-4" />
                  New Project
                </Button>
              )}
            </div>

            {projects.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Video className="h-12 w-12 text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground">No projects yet</p>
                  <p className="text-sm text-muted-foreground/75">
                    Create your first project to get started
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-2">
                {projects.map((project) => (
                  <Link
                    key={project.id}
                    href={`/admin/brands/${brandId}/projects/${project.id}`}
                  >
                    <Card className="h-full transition-all hover:shadow-lg hover:border-primary/50 cursor-pointer">
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <CardTitle className="text-lg">
                            {project.name}
                          </CardTitle>
                          <Badge variant={getProjectStatusBadge(project.status).variant}>
                            {getProjectStatusBadge(project.status).label}
                          </Badge>
                        </div>
                        {project.description && (
                          <CardDescription className="line-clamp-2">
                            {project.description}
                          </CardDescription>
                        )}
                      </CardHeader>

                      <CardContent className="space-y-4">
                        {/* Meta Info Grid */}
                        <div className="grid grid-cols-3 gap-4 text-sm">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Calendar className="h-4 w-4" />
                              <span>Timeline</span>
                            </div>
                            <p className="text-xs text-muted-foreground/75">
                              {project.start_date
                                ? new Date(
                                    project.start_date
                                  ).toLocaleDateString()
                                : 'N/A'}{' '}
                              -{' '}
                              {project.end_date
                                ? new Date(project.end_date).toLocaleDateString()
                                : 'N/A'}
                            </p>
                          </div>

                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Calendar className="h-4 w-4" />
                              <span>Deadline</span>
                            </div>
                            <p className="text-xs text-muted-foreground/75">
                              {project.submission_deadline
                                ? new Date(
                                    project.submission_deadline
                                  ).toLocaleDateString()
                                : 'N/A'}
                            </p>
                          </div>

                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Users className="h-4 w-4" />
                              <span>Creators</span>
                            </div>
                            <p className="text-xs font-medium">
                              {project.completedCreators}/
                              {project.totalCreators}
                            </p>
                          </div>
                        </div>

                        {/* Progress */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground">
                              Videos
                            </span>
                            <span className="text-xs font-semibold">
                              {project.totalVideosUploaded}/
                              {project.totalVideosAssigned}
                            </span>
                          </div>
                          <Progress
                            value={
                              project.totalVideosAssigned > 0
                                ? (project.totalVideosUploaded /
                                    project.totalVideosAssigned) *
                                  100
                                : 0
                            }
                            className="h-2"
                          />
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Products Tab */}
          <TabsContent value="products" className="mt-6">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Products</h2>
                <p className="text-sm text-muted-foreground">
                  {products.length}{' '}
                  {products.length === 1 ? 'product' : 'products'}
                </p>
              </div>
              {canCreate && (
                <Button
                  onClick={() => setProductDialogOpen(true)}
                  className="gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add Product
                </Button>
              )}
            </div>

            {products.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Package className="h-12 w-12 text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground">No products yet</p>
                  <p className="text-sm text-muted-foreground/75">
                    Add products to associate with this brand
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {products.map((product) => (
                  <Card key={product.id} className="overflow-hidden group relative">
                    {product.thumbnail_url && (
                      <div className="relative w-full aspect-square bg-muted">
                        <img
                          src={product.thumbnail_url}
                          alt={product.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <CardContent className="pt-4">
                      <h3 className="font-semibold line-clamp-2">
                        {product.name}
                      </h3>
                      {product.content_guide_url && (
                        <a
                          href={product.content_guide_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline flex items-center gap-1 mt-1"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Content Guide
                        </a>
                      )}
                      {product.product_link && (
                        <a
                          href={product.product_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline flex items-center gap-1 mt-1"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Product Link
                        </a>
                      )}
                      {canCreate && (
                        <div className="flex gap-1 mt-3">
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 h-8 text-xs"
                            onClick={() => handleEditProduct(product)}
                          >
                            <Pencil className="w-3 h-3 mr-1" />
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleDeleteProduct(product.id, product.name)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Create Project Dialog */}
      <Dialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">Project Name</Label>
              <Input
                id="project-name"
                placeholder="e.g., Summer Campaign"
                value={projectFormData.name}
                onChange={(e) =>
                  setProjectFormData({
                    ...projectFormData,
                    name: e.target.value,
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-description">Description</Label>
              <Textarea
                id="project-description"
                placeholder="Describe your project"
                value={projectFormData.description}
                onChange={(e) =>
                  setProjectFormData({
                    ...projectFormData,
                    description: e.target.value,
                  })
                }
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start-date">Start Date</Label>
                <Input
                  id="start-date"
                  type="date"
                  value={projectFormData.start_date}
                  onChange={(e) =>
                    setProjectFormData({
                      ...projectFormData,
                      start_date: e.target.value,
                    })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="end-date">End Date</Label>
                <Input
                  id="end-date"
                  type="date"
                  value={projectFormData.end_date}
                  onChange={(e) =>
                    setProjectFormData({
                      ...projectFormData,
                      end_date: e.target.value,
                    })
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="submission-deadline">Submission Deadline</Label>
              <Input
                id="submission-deadline"
                type="date"
                value={projectFormData.submission_deadline}
                onChange={(e) =>
                  setProjectFormData({
                    ...projectFormData,
                    submission_deadline: e.target.value,
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-budget">Budget ($)</Label>
              <Input
                id="project-budget"
                type="number"
                min={0}
                step="0.01"
                placeholder="e.g., 10000"
                value={projectFormData.budget}
                onChange={(e) =>
                  setProjectFormData({
                    ...projectFormData,
                    budget: e.target.value,
                  })
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setProjectDialogOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateProject}
              disabled={submitting || !projectFormData.name.trim()}
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Product Dialog */}
      <Dialog open={editProductDialogOpen} onOpenChange={setEditProductDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Product</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-product-name">Product Name</Label>
              <Input
                id="edit-product-name"
                placeholder="e.g., Amazing Product"
                value={editProductFormData.name}
                onChange={(e) =>
                  setEditProductFormData({
                    ...editProductFormData,
                    name: e.target.value,
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-product-thumbnail">Thumbnail URL</Label>
              <Input
                id="edit-product-thumbnail"
                placeholder="https://example.com/image.jpg"
                value={editProductFormData.thumbnail_url}
                onChange={(e) =>
                  setEditProductFormData({
                    ...editProductFormData,
                    thumbnail_url: e.target.value,
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-product-guide">Content Guide URL</Label>
              <Input
                id="edit-product-guide"
                placeholder="https://example.com/guide"
                value={editProductFormData.content_guide_url}
                onChange={(e) =>
                  setEditProductFormData({
                    ...editProductFormData,
                    content_guide_url: e.target.value,
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-product-link">Product Link</Label>
              <Input
                id="edit-product-link"
                placeholder="https://example.com/product"
                value={editProductFormData.product_link}
                onChange={(e) =>
                  setEditProductFormData({
                    ...editProductFormData,
                    product_link: e.target.value,
                  })
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditProductDialogOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdateProduct}
              disabled={submitting || !editProductFormData.name.trim()}
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Product Dialog */}
      <Dialog open={productDialogOpen} onOpenChange={setProductDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Product</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="product-name">Product Name</Label>
              <Input
                id="product-name"
                placeholder="e.g., Amazing Product"
                value={productFormData.name}
                onChange={(e) =>
                  setProductFormData({
                    ...productFormData,
                    name: e.target.value,
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="product-thumbnail">Thumbnail URL</Label>
              <Input
                id="product-thumbnail"
                placeholder="https://example.com/image.jpg"
                value={productFormData.thumbnail_url}
                onChange={(e) =>
                  setProductFormData({
                    ...productFormData,
                    thumbnail_url: e.target.value,
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="product-guide">Content Guide URL</Label>
              <Input
                id="product-guide"
                placeholder="https://example.com/guide"
                value={productFormData.content_guide_url}
                onChange={(e) =>
                  setProductFormData({
                    ...productFormData,
                    content_guide_url: e.target.value,
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="product-link">Product Link</Label>
              <Input
                id="product-link"
                placeholder="https://example.com/product"
                value={productFormData.product_link}
                onChange={(e) =>
                  setProductFormData({
                    ...productFormData,
                    product_link: e.target.value,
                  })
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setProductDialogOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateProduct}
              disabled={submitting || !productFormData.name.trim()}
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Product
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
