'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useUserRole } from '@/hooks/useUserRole';
import {
  ArrowLeft, Loader2, Copy, Check, DollarSign, Plus,
  Video, ExternalLink, FileText, Trash2, Upload, Pencil, Save, MessageSquare,
  Package, X, PenLine, Bell, AlertCircle
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';

import { cn } from '@/lib/utils';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import { getCreatorStatus, getProgressPercent } from '@/lib/utils';
import type { Creator, Payment, Product } from '@/types/database';

interface VideoData {
  id: string;
  tiktok_url: string;
  spark_ad_code: string;
  tiktok_video_id: string | null;
  title: string | null;
  view_count: number;
  gmv: number | null;
  status: string;
  created_at: string;
}

interface PCFullData {
  id: string;
  project_id: string;
  creator_id: string;
  unique_slug: string;
  assigned_video_count: number;
  content_type: string;
  live_hours: number | null;
  contract_amount: number;
  advance_payment: number;
  remaining_payment: number;
  commission_rate: number;
  contact_point: string | null;
  communication_link: string | null;
  payment_email: string | null;
  legal_name: string | null;
  signature_url: string | null;
  signed_at: string | null;
  shipping_name: string | null;
  shipping_address: string | null;
  shipping_phone: string | null;
  contract_notes: string | null;
  payment_method: string;
  ach_account_name: string | null;
  ach_bank_name: string | null;
  ach_account_number: string | null;
  ach_beneficiary_address: string | null;
  ach_routing_number: string | null;
  status: string;
  created_at: string;
  creators: Creator;
  projects: {
    id: string;
    name: string;
    brand_id: string;
    brands: { id: string; name: string };
  };
}

export default function CreatorDetailPage() {
  const params = useParams();
  const pcId = params.pcId as string;
  const projectId = params.projectId as string;
  const brandId = params.brandId as string;

  const supabase = createSupabaseBrowser();
  const router = useRouter();
  const { isBrandViewer, isOperator } = useUserRole();

  const [loading, setLoading] = useState(true);
  const [pcData, setPcData] = useState<PCFullData | null>(null);
  const [videos, setVideos] = useState<VideoData[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  // Add payment dialog
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    payment_date: new Date().toISOString().split('T')[0],
    note: '',
  });
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [addingPayment, setAddingPayment] = useState(false);
  const [uploadingInvoice, setUploadingInvoice] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [copiedUrl, setCopiedUrl] = useState(false);

  // Product assignment
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [assignedProductIds, setAssignedProductIds] = useState<Set<string>>(new Set());
  const [assignedProducts, setAssignedProducts] = useState<(Product & { pcpId: string })[]>([]);
  const [assigningProduct, setAssigningProduct] = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());

  // Reminds & Reviews
  const [reminds, setReminds] = useState<{ id: string; remind_date: string; note: string | null; author_name: string | null; created_at: string }[]>([]);
  const [reviews, setReviews] = useState<{ id: string; review_date: string; note: string | null; status: string; author_name: string | null; resolve_note: string | null; created_at: string }[]>([]);
  const [remindDate, setRemindDate] = useState(new Date().toISOString().split('T')[0]);
  const [remindNote, setRemindNote] = useState('');
  const [addingRemind, setAddingRemind] = useState(false);
  const [reviewDate, setReviewDate] = useState(new Date().toISOString().split('T')[0]);
  const [reviewNote, setReviewNote] = useState('');
  const [addingReview, setAddingReview] = useState(false);

  // Contract amount editing
  const [editingContract, setEditingContract] = useState(false);
  const [contractInput, setContractInput] = useState('');
  const [savingContract, setSavingContract] = useState(false);

  // Contact info editing
  const [editingContact, setEditingContact] = useState(false);
  const [contactForm, setContactForm] = useState({
    contact_point: '', communication_link: '', payment_email: '',
    payment_method: 'paypal', ach_account_name: '', ach_bank_name: '', ach_account_number: '', ach_routing_number: '', ach_beneficiary_address: '',
  });
  const [savingContact, setSavingContact] = useState(false);

  // Delete creator
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletingCreator, setDeletingCreator] = useState(false);

  // Role-based permissions
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  // operator can edit: sample_shipped, contact_point, communication_link, payment_email (NOT contract_amount)
  const canEditContract = isSuperAdmin;
  const canEditContact = isSuperAdmin || isOperator;
  const canDelete = !isBrandViewer && !isOperator;
  const canAddPayment = isSuperAdmin;

  // Inline editing for assigned_video_count, advance_payment, remaining_payment
  const [editingVideoCount, setEditingVideoCount] = useState(false);
  const [videoCountInput, setVideoCountInput] = useState('');
  const [savingVideoCount, setSavingVideoCount] = useState(false);

  const [editingAdvance, setEditingAdvance] = useState(false);
  const [advanceInput, setAdvanceInput] = useState('');
  const [savingAdvance, setSavingAdvance] = useState(false);

  const [editingRemaining, setEditingRemaining] = useState(false);
  const [remainingInput, setRemainingInput] = useState('');
  const [savingRemaining, setSavingRemaining] = useState(false);

  const [editingCommission, setEditingCommission] = useState(false);
  const [commissionInput, setCommissionInput] = useState('');
  const [savingCommission, setSavingCommission] = useState(false);

  const [editingLiveHours, setEditingLiveHours] = useState(false);
  const [liveHoursInput, setLiveHoursInput] = useState('');
  const [savingLiveHours, setSavingLiveHours] = useState(false);

  useEffect(() => {
    fetchData();
    checkSuperAdmin();
  }, []);

  const checkSuperAdmin = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('admin_users')
      .select('role')
      .eq('auth_id', user.id)
      .single();
    if (data?.role === 'super_admin') setIsSuperAdmin(true);
  };

  const fetchData = async () => {
    try {
      setLoading(true);

      // Fetch project_creator with relations
      const { data: pc, error: pcError } = await supabase
        .from('project_creators')
        .select('*, creators(*), projects(id, name, brand_id, brands(id, name))')
        .eq('id', pcId)
        .single();

      if (pcError) throw pcError;
      setPcData(pc as PCFullData);

      // Fetch videos
      const { data: vids } = await supabase
        .from('videos')
        .select('*')
        .eq('project_creator_id', pcId)
        .order('created_at', { ascending: false });
      setVideos((vids || []) as VideoData[]);

      // Fetch payments
      const { data: pays } = await supabase
        .from('payments')
        .select('*')
        .eq('project_creator_id', pcId)
        .order('payment_date', { ascending: false });
      setPayments((pays || []) as Payment[]);

      // Fetch reminds
      const { data: remindData } = await supabase
        .from('project_creator_reminds')
        .select('id, remind_date, note, author_name, created_at')
        .eq('project_creator_id', pcId)
        .order('created_at', { ascending: false });
      setReminds((remindData || []) as any[]);

      // Fetch reviews
      const { data: reviewData } = await supabase
        .from('project_creator_reviews')
        .select('id, review_date, note, status, author_name, resolve_note, created_at')
        .eq('project_creator_id', pcId)
        .order('created_at', { ascending: false });
      setReviews((reviewData || []) as any[]);

      // Fetch all products for this brand
      if (pc) {
        const brandIdFromProject = (pc as PCFullData).projects.brand_id;
        const { data: brandProducts } = await supabase
          .from('products')
          .select('*')
          .eq('brand_id', brandIdFromProject)
          .order('name');
        setAllProducts((brandProducts || []) as Product[]);

        // Fetch assigned products
        const { data: pcpData } = await supabase
          .from('project_creator_products')
          .select('id, product_id, products(*)')
          .eq('project_creator_id', pcId);

        if (pcpData) {
          const assigned: (Product & { pcpId: string })[] = [];
          const ids: string[] = [];
          for (const pcp of pcpData as any[]) {
            ids.push(pcp.product_id);
            if (pcp.products) {
              const prod = Array.isArray(pcp.products) ? pcp.products[0] : pcp.products;
              if (prod) {
                assigned.push({ ...prod, pcpId: pcp.id });
              }
            }
          }
          setAssignedProducts(assigned);
          setAssignedProductIds(new Set(ids));
        }
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddPayment = async () => {
    if (!paymentForm.amount || parseFloat(paymentForm.amount) <= 0) return;

    try {
      setAddingPayment(true);
      let invoiceUrl: string | null = null;

      // Upload invoice file if selected
      if (invoiceFile) {
        setUploadingInvoice(true);
        const formData = new FormData();
        formData.append('file', invoiceFile);

        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        if (res.ok) {
          const data = await res.json();
          invoiceUrl = data.url;
        }
        setUploadingInvoice(false);
      }

      const { error } = await supabase.from('payments').insert({
        project_creator_id: pcId,
        amount: parseFloat(paymentForm.amount),
        payment_date: paymentForm.payment_date,
        note: paymentForm.note || null,
        invoice_url: invoiceUrl,
      });

      if (error) throw error;

      setPaymentForm({
        amount: '',
        payment_date: new Date().toISOString().split('T')[0],
        note: '',
      });
      setInvoiceFile(null);
      setShowAddPayment(false);
      await fetchData();
    } catch (error) {
      console.error('Error adding payment:', error);
    } finally {
      setAddingPayment(false);
    }
  };

  const handleDeletePayment = async (paymentId: string) => {
    if (!confirm('Are you sure you want to delete this payment record?')) return;
    try {
      await supabase.from('payments').delete().eq('id', paymentId);
      await fetchData();
    } catch (error) {
      console.error('Error deleting payment:', error);
    }
  };

  const handleAddRemind = async () => {
    try {
      setAddingRemind(true);
      const { data: { session } } = await supabase.auth.getSession();
      const authorName = session?.user?.email?.split('@')[0] || 'Unknown';
      const { error } = await supabase.from('project_creator_reminds').insert({
        project_creator_id: pcId,
        remind_date: remindDate,
        note: remindNote.trim() || null,
        author_name: authorName,
      });
      if (!error) {
        setReminds(prev => [{ id: crypto.randomUUID(), remind_date: remindDate, note: remindNote.trim() || null, author_name: authorName, created_at: new Date().toISOString() }, ...prev]);
        setRemindNote('');
      }
    } catch (err) { console.error(err); }
    finally { setAddingRemind(false); }
  };

  const handleAddReview = async () => {
    if (!reviewNote.trim()) return;
    try {
      setAddingReview(true);
      const { data: { session } } = await supabase.auth.getSession();
      const authorName = session?.user?.email?.split('@')[0] || 'Unknown';
      const { error } = await supabase.from('project_creator_reviews').insert({
        project_creator_id: pcId,
        review_date: reviewDate,
        note: reviewNote.trim(),
        status: 'need_review',
        author_name: authorName,
      });
      if (!error) {
        setReviews(prev => [{ id: crypto.randomUUID(), review_date: reviewDate, note: reviewNote.trim(), status: 'need_review', author_name: authorName, resolve_note: null, created_at: new Date().toISOString() }, ...prev]);
        setReviewNote('');
      }
    } catch (err) { console.error(err); }
    finally { setAddingReview(false); }
  };

  const handleEditContract = () => {
    setContractInput(String(pcData?.contract_amount || 0));
    setEditingContract(true);
  };

  const handleSaveContract = async () => {
    try {
      setSavingContract(true);
      const newAmount = parseFloat(contractInput) || 0;
      const advance = Math.round(newAmount * 50) / 100;
      const { error } = await supabase
        .from('project_creators')
        .update({ contract_amount: newAmount, advance_payment: advance, remaining_payment: newAmount - advance })
        .eq('id', pcId);

      if (error) throw error;
      setEditingContract(false);
      await fetchData();
    } catch (error) {
      console.error('Error saving contract amount:', error);
    } finally {
      setSavingContract(false);
    }
  };

  const handleEditVideoCount = () => {
    setVideoCountInput(String(pcData?.assigned_video_count || 0));
    setEditingVideoCount(true);
  };

  const handleSaveVideoCount = async () => {
    try {
      setSavingVideoCount(true);
      const newCount = parseInt(videoCountInput) || 0;
      const { error } = await supabase
        .from('project_creators')
        .update({ assigned_video_count: newCount })
        .eq('id', pcId);
      if (error) throw error;
      setEditingVideoCount(false);
      await fetchData();
    } catch (error) {
      console.error('Error saving video count:', error);
    } finally {
      setSavingVideoCount(false);
    }
  };

  const handleEditAdvance = () => {
    setAdvanceInput(String(pcData?.advance_payment || 0));
    setEditingAdvance(true);
  };

  const handleSaveAdvance = async () => {
    try {
      setSavingAdvance(true);
      const newAmount = parseFloat(advanceInput) || 0;
      const { error } = await supabase
        .from('project_creators')
        .update({ advance_payment: newAmount })
        .eq('id', pcId);
      if (error) throw error;
      setEditingAdvance(false);
      await fetchData();
    } catch (error) {
      console.error('Error saving advance payment:', error);
    } finally {
      setSavingAdvance(false);
    }
  };

  const handleEditRemaining = () => {
    setRemainingInput(String(pcData?.remaining_payment || 0));
    setEditingRemaining(true);
  };

  const handleSaveRemaining = async () => {
    try {
      setSavingRemaining(true);
      const newAmount = parseFloat(remainingInput) || 0;
      const { error } = await supabase
        .from('project_creators')
        .update({ remaining_payment: newAmount })
        .eq('id', pcId);
      if (error) throw error;
      setEditingRemaining(false);
      await fetchData();
    } catch (error) {
      console.error('Error saving remaining payment:', error);
    } finally {
      setSavingRemaining(false);
    }
  };

  const handleEditCommission = () => {
    setCommissionInput(String(pcData?.commission_rate || 0));
    setEditingCommission(true);
  };

  const handleSaveCommission = async () => {
    try {
      setSavingCommission(true);
      const newRate = parseFloat(commissionInput) || 0;
      const { error } = await supabase
        .from('project_creators')
        .update({ commission_rate: newRate })
        .eq('id', pcId);
      if (error) throw error;
      setEditingCommission(false);
      await fetchData();
    } catch (error) {
      console.error('Error saving commission rate:', error);
    } finally {
      setSavingCommission(false);
    }
  };

  const handleSaveLiveHours = async () => {
    try {
      setSavingLiveHours(true);
      const hours = parseFloat(liveHoursInput) || 0;
      const { error } = await supabase
        .from('project_creators')
        .update({ live_hours: hours })
        .eq('id', pcId);
      if (error) throw error;
      setEditingLiveHours(false);
      await fetchData();
    } catch (error) {
      console.error('Error saving live hours:', error);
    } finally {
      setSavingLiveHours(false);
    }
  };

  const handleEditContact = () => {
    setContactForm({
      contact_point: pcData?.contact_point || '',
      communication_link: pcData?.communication_link || '',
      payment_email: pcData?.payment_email || '',
      payment_method: pcData?.payment_method || 'paypal',
      ach_account_name: pcData?.ach_account_name || '',
      ach_bank_name: pcData?.ach_bank_name || '',
      ach_account_number: pcData?.ach_account_number || '',
      ach_beneficiary_address: pcData?.ach_beneficiary_address || '',
      ach_routing_number: pcData?.ach_routing_number || '',
    });
    setEditingContact(true);
  };

  const handleSaveContact = async () => {
    try {
      setSavingContact(true);
      const isAch = contactForm.payment_method === 'ach';
      const { error } = await supabase
        .from('project_creators')
        .update({
          contact_point: contactForm.contact_point.trim() || null,
          communication_link: contactForm.communication_link.trim() || null,
          payment_method: contactForm.payment_method,
          payment_email: contactForm.payment_email.trim() || null,
          ach_account_name: isAch ? (contactForm.ach_account_name.trim() || null) : null,
          ach_bank_name: isAch ? (contactForm.ach_bank_name.trim() || null) : null,
          ach_account_number: isAch ? (contactForm.ach_account_number.trim() || null) : null,
          ach_routing_number: isAch ? (contactForm.ach_routing_number.trim() || null) : null,
          ach_beneficiary_address: isAch ? (contactForm.ach_beneficiary_address.trim() || null) : null,
        })
        .eq('id', pcId);

      if (error) throw error;
      setEditingContact(false);
      await fetchData();
    } catch (error) {
      console.error('Error saving contact info:', error);
    } finally {
      setSavingContact(false);
    }
  };

  const handleDeleteCreator = async () => {
    try {
      setDeletingCreator(true);
      const { error } = await supabase
        .from('project_creators')
        .update({ is_deleted: true })
        .eq('id', pcId);
      if (error) throw error;
      router.push(`/admin/brands/${brandId}/projects/${projectId}`);
    } catch (error) {
      console.error('Error deleting creator:', error);
      setDeletingCreator(false);
      setShowDeleteDialog(false);
    }
  };

  const handleAssignProducts = async () => {
    if (selectedProductIds.size === 0) return;
    try {
      setAssigningProduct(true);
      const inserts = Array.from(selectedProductIds).map(productId => ({
        project_creator_id: pcId,
        product_id: productId,
      }));
      const { error } = await supabase.from('project_creator_products').insert(inserts);
      if (error) throw error;
      await fetchData();
      setSelectedProductIds(new Set());
      setShowProductPicker(false);
    } catch (error) {
      console.error('Error assigning products:', error);
    } finally {
      setAssigningProduct(false);
    }
  };

  const handleRemoveProduct = async (pcpId: string) => {
    try {
      const { error } = await supabase
        .from('project_creator_products')
        .delete()
        .eq('id', pcpId);
      if (error) throw error;
      await fetchData();
    } catch (error) {
      console.error('Error removing product:', error);
    }
  };

  const handleCopyUrl = async () => {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const url = `${baseUrl}/c/${pcData?.unique_slug}`;
    await navigator.clipboard.writeText(url);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!pcData) {
    return <div className="p-6"><p className="text-muted-foreground">Creator not found</p></div>;
  }

  const creator = pcData.creators;
  const project = pcData.projects;
  const activeVideos = videos.filter(v => v.status !== 'rejected');
  const progressPercent = getProgressPercent(activeVideos.length, pcData.assigned_video_count);
  const creatorStatus = getCreatorStatus(activeVideos.length, pcData.assigned_video_count);
  const contractAmount = pcData.contract_amount || 0;
  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const balance = contractAmount - totalPaid;
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const submissionUrl = `${baseUrl}/c/${pcData.unique_slug}`;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="max-w-5xl mx-auto p-6">
          <div className="flex items-center gap-4 mb-4">
            <Button variant="ghost" size="icon" asChild>
              <Link href={`/admin/brands/${brandId}/projects/${projectId}`}>
                <ArrowLeft className="w-4 h-4" />
              </Link>
            </Button>
            <div className="flex-1">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <span>{project.brands.name}</span>
                <span>/</span>
                <span>{project.name}</span>
              </div>
              <h1 className="text-2xl font-bold">{creator.name}</h1>
              <div className="flex items-center gap-3 mt-1">
                {creator.tiktok_handle && (
                  <span className="font-mono text-sm text-muted-foreground">@{creator.tiktok_handle}</span>
                )}
                {!isBrandViewer && (
                  <input
                    className="text-sm text-muted-foreground bg-transparent border-b border-transparent hover:border-muted-foreground/30 focus:border-primary focus:outline-none px-0 py-0.5 w-56"
                    defaultValue={creator.email || ''}
                    placeholder="Add email..."
                    onBlur={async (e) => {
                      const val = e.target.value.trim();
                      if (val !== (creator.email || '')) {
                        await supabase.from('creators').update({ email: val }).eq('id', creator.id);
                        setPcData(prev => prev ? { ...prev, creators: { ...prev.creators, email: val } } as PCFullData : prev);
                      }
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  />
                )}
              </div>
            </div>
            <Badge variant={creatorStatus.variant} className="text-sm">{creatorStatus.label}</Badge>
            {canDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Overview Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {/* Video Progress - editable by super_admin */}
          <Card
            className={cn(isSuperAdmin && !editingVideoCount && 'cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all')}
            onClick={() => isSuperAdmin && !editingVideoCount && handleEditVideoCount()}
          >
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                Video Progress
                {isSuperAdmin && !editingVideoCount && <Pencil className="w-3 h-3 opacity-40" />}
              </p>
              {editingVideoCount ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{activeVideos.length} /</span>
                  <Input
                    type="number"
                    min={0}
                    value={videoCountInput}
                    onChange={(e) => setVideoCountInput(e.target.value)}
                    className="h-8 text-sm w-20"
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveVideoCount();
                      if (e.key === 'Escape') setEditingVideoCount(false);
                    }}
                    disabled={savingVideoCount}
                  />
                  <Button size="icon" className="h-7 w-7 shrink-0" onClick={(e) => { e.stopPropagation(); handleSaveVideoCount(); }} disabled={savingVideoCount}>
                    {savingVideoCount ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <Progress value={progressPercent} className="flex-1" />
                  <span className="text-sm font-bold">{activeVideos.length}/{pcData.assigned_video_count}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Live Hours - only for live_shopping */}
          {pcData.content_type === 'live_shopping' && (
            <Card
              className={cn(isSuperAdmin && !editingLiveHours && 'cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all')}
              onClick={() => isSuperAdmin && !editingLiveHours && (() => { setLiveHoursInput(String(pcData?.live_hours || 0)); setEditingLiveHours(true); })()}
            >
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                  Live Hours
                  {isSuperAdmin && !editingLiveHours && <Pencil className="w-3 h-3 opacity-40" />}
                </p>
                {editingLiveHours ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      step="0.5"
                      value={liveHoursInput}
                      onChange={(e) => setLiveHoursInput(e.target.value)}
                      className="h-8 text-sm w-20"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveLiveHours();
                        if (e.key === 'Escape') setEditingLiveHours(false);
                      }}
                      disabled={savingLiveHours}
                    />
                    <span className="text-sm text-muted-foreground">hrs</span>
                    <Button size="icon" className="h-7 w-7 shrink-0" onClick={(e) => { e.stopPropagation(); handleSaveLiveHours(); }} disabled={savingLiveHours}>
                      {savingLiveHours ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    </Button>
                  </div>
                ) : (
                  <p className="text-2xl font-bold">{pcData.live_hours || 0} <span className="text-sm font-normal text-muted-foreground">hours</span></p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Contract - editable by super_admin and operator */}
          <Card
            className={cn(canEditContract && !editingContract && 'cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all')}
            onClick={() => canEditContract && !editingContract && handleEditContract()}
          >
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                Contract
                {canEditContract && !editingContract && <Pencil className="w-3 h-3 opacity-40" />}
              </p>
              {editingContract ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">$</span>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={contractInput}
                    onChange={(e) => setContractInput(e.target.value)}
                    className="h-8 text-sm"
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveContract();
                      if (e.key === 'Escape') setEditingContract(false);
                    }}
                    disabled={savingContract}
                  />
                  <Button size="icon" className="h-7 w-7 shrink-0" onClick={(e) => { e.stopPropagation(); handleSaveContract(); }} disabled={savingContract}>
                    {savingContract ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  </Button>
                </div>
              ) : (
                <p className="text-xl font-bold">{formatCurrency(contractAmount)}</p>
              )}
            </CardContent>
          </Card>

          {/* Paid / Balance */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Paid</p>
                  <p className="text-xl font-bold text-emerald-600">{formatCurrency(totalPaid)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground mb-1">Balance</p>
                  <p className={cn('text-xl font-bold', balance > 0 ? 'text-amber-600' : balance === 0 ? 'text-emerald-600' : 'text-destructive')}>
                    {formatCurrency(balance)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Advance / Remaining Payment */}
        <div className="grid grid-cols-2 gap-4">
          <Card
            className={cn(isSuperAdmin && !editingAdvance && 'cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all')}
            onClick={() => isSuperAdmin && !editingAdvance && handleEditAdvance()}
          >
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                Advance Payment
                {isSuperAdmin && !editingAdvance && <Pencil className="w-3 h-3 opacity-40" />}
              </p>
              {editingAdvance ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">$</span>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={advanceInput}
                    onChange={(e) => setAdvanceInput(e.target.value)}
                    className="h-8 text-sm"
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveAdvance();
                      if (e.key === 'Escape') setEditingAdvance(false);
                    }}
                    disabled={savingAdvance}
                  />
                  <Button size="icon" className="h-7 w-7 shrink-0" onClick={(e) => { e.stopPropagation(); handleSaveAdvance(); }} disabled={savingAdvance}>
                    {savingAdvance ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  </Button>
                </div>
              ) : (
                <p className="text-xl font-bold">{formatCurrency(pcData.advance_payment || 0)}</p>
              )}
            </CardContent>
          </Card>
          <Card
            className={cn(isSuperAdmin && !editingRemaining && 'cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all')}
            onClick={() => isSuperAdmin && !editingRemaining && handleEditRemaining()}
          >
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                Remaining Payment
                {isSuperAdmin && !editingRemaining && <Pencil className="w-3 h-3 opacity-40" />}
              </p>
              {editingRemaining ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">$</span>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={remainingInput}
                    onChange={(e) => setRemainingInput(e.target.value)}
                    className="h-8 text-sm"
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveRemaining();
                      if (e.key === 'Escape') setEditingRemaining(false);
                    }}
                    disabled={savingRemaining}
                  />
                  <Button size="icon" className="h-7 w-7 shrink-0" onClick={(e) => { e.stopPropagation(); handleSaveRemaining(); }} disabled={savingRemaining}>
                    {savingRemaining ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  </Button>
                </div>
              ) : (
                <p className="text-xl font-bold">{formatCurrency(pcData.remaining_payment || 0)}</p>
              )}
            </CardContent>
          </Card>
          <Card
            className={cn(isSuperAdmin && !editingCommission && 'cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all')}
            onClick={() => isSuperAdmin && !editingCommission && handleEditCommission()}
          >
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                Commission Rate
                {isSuperAdmin && !editingCommission && <Pencil className="w-3 h-3 opacity-40" />}
              </p>
              {editingCommission ? (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.1"
                    value={commissionInput}
                    onChange={(e) => setCommissionInput(e.target.value)}
                    className="h-8 text-sm"
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveCommission();
                      if (e.key === 'Escape') setEditingCommission(false);
                    }}
                    disabled={savingCommission}
                  />
                  <span className="text-sm font-medium">%</span>
                  <Button size="icon" className="h-7 w-7 shrink-0" onClick={(e) => { e.stopPropagation(); handleSaveCommission(); }} disabled={savingCommission}>
                    {savingCommission ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  </Button>
                </div>
              ) : (
                <p className="text-xl font-bold">{pcData.commission_rate || 0}%</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Submission URL */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <p className="text-sm text-muted-foreground">Submission URL:</p>
              <code className="text-sm bg-muted px-2 py-1 rounded flex-1 truncate">{submissionUrl}</code>
              <Button variant="outline" size="sm" onClick={handleCopyUrl}>
                {copiedUrl ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
                {copiedUrl ? 'Copied' : 'Copy'}
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={submissionUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-4 h-4 mr-1" />
                  Open
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Contact Information — hidden from brand viewers */}
        {!isBrandViewer && <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Contact &amp; Communication
              </CardTitle>
              {canEditContact && !editingContact ? (
                <Button variant="ghost" size="sm" onClick={handleEditContact}>
                  <Pencil className="w-3 h-3 mr-1" />
                  Edit
                </Button>
              ) : editingContact ? (
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditingContact(false)} disabled={savingContact}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSaveContact} disabled={savingContact}>
                    {savingContact ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                    Save
                  </Button>
                </div>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            {editingContact ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Contact Point</Label>
                  <Input
                    placeholder="e.g. Instagram DM, Email, TikTok Shop Chat..."
                    value={contactForm.contact_point}
                    onChange={(e) => setContactForm(prev => ({ ...prev, contact_point: e.target.value }))}
                    disabled={savingContact}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Communication Link</Label>
                  <Input
                    type="url"
                    placeholder="https://... (Slack, email thread, chat link, etc.)"
                    value={contactForm.communication_link}
                    onChange={(e) => setContactForm(prev => ({ ...prev, communication_link: e.target.value }))}
                    disabled={savingContact}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Payment Method</Label>
                  <select
                    className="flex h-9 w-full rounded-md border px-3 py-1 text-sm bg-background"
                    value={contactForm.payment_method}
                    onChange={(e) => setContactForm(prev => ({ ...prev, payment_method: e.target.value }))}
                    disabled={savingContact}
                  >
                    <option value="paypal">PayPal</option>
                    <option value="ach">ACH (Bank Transfer)</option>
                  </select>
                </div>
                {contactForm.payment_method === 'paypal' ? (
                  <div className="space-y-1">
                    <Label className="text-xs">Payment Email (PayPal)</Label>
                    <Input
                      type="email"
                      placeholder="payment@example.com"
                      value={contactForm.payment_email}
                      onChange={(e) => setContactForm(prev => ({ ...prev, payment_email: e.target.value }))}
                      disabled={savingContact}
                    />
                  </div>
                ) : (
                  <div className="space-y-3 p-3 border rounded-md bg-muted/30">
                    <div className="space-y-1">
                      <Label className="text-xs">Payment Email (for remittance notices)</Label>
                      <Input
                        type="email"
                        placeholder="payment@example.com"
                        value={contactForm.payment_email}
                        onChange={(e) => setContactForm(prev => ({ ...prev, payment_email: e.target.value }))}
                        disabled={savingContact}
                      />
                    </div>
                    <p className="text-xs font-medium">ACH Bank Details</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Account Name</Label>
                        <Input
                          placeholder="John Doe"
                          value={contactForm.ach_account_name}
                          onChange={(e) => setContactForm(prev => ({ ...prev, ach_account_name: e.target.value }))}
                          disabled={savingContact}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Bank Name</Label>
                        <Input
                          placeholder="Chase, Bank of America..."
                          value={contactForm.ach_bank_name}
                          onChange={(e) => setContactForm(prev => ({ ...prev, ach_bank_name: e.target.value }))}
                          disabled={savingContact}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Account Number</Label>
                        <Input
                          placeholder="Account number"
                          value={contactForm.ach_account_number}
                          onChange={(e) => setContactForm(prev => ({ ...prev, ach_account_number: e.target.value }))}
                          disabled={savingContact}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Routing Number</Label>
                        <Input
                          placeholder="Routing number"
                          value={contactForm.ach_routing_number}
                          onChange={(e) => setContactForm(prev => ({ ...prev, ach_routing_number: e.target.value }))}
                          disabled={savingContact}
                        />
                      </div>
                      <div className="col-span-2 space-y-1">
                        <Label className="text-xs">Beneficiary Address</Label>
                        <Input
                          placeholder="Full address"
                          value={contactForm.ach_beneficiary_address}
                          onChange={(e) => setContactForm(prev => ({ ...prev, ach_beneficiary_address: e.target.value }))}
                          disabled={savingContact}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Contact Point</p>
                  <p className="text-sm">{pcData.contact_point ? pcData.contact_point : <span className="text-muted-foreground">Not set</span>}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Communication Link</p>
                  {pcData.communication_link ? (
                    <a
                      href={pcData.communication_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Open Link
                    </a>
                  ) : (
                    <p className="text-sm text-muted-foreground">Not set</p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Payment Method</p>
                  <Badge variant="outline" className="text-xs">
                    {pcData.payment_method === 'ach' ? 'ACH (Bank Transfer)' : 'PayPal'}
                  </Badge>
                </div>
                {pcData.payment_method === 'ach' ? (
                  <div className="col-span-3 grid grid-cols-4 gap-4 pt-2 border-t">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Payment Email</p>
                      <p className="text-sm">{pcData.payment_email || <span className="text-muted-foreground">Not set</span>}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Account Name</p>
                      <p className="text-sm">{pcData.ach_account_name || <span className="text-muted-foreground">Not set</span>}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Bank Name</p>
                      <p className="text-sm">{pcData.ach_bank_name || <span className="text-muted-foreground">Not set</span>}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Account Number</p>
                      <p className="text-sm font-mono">{pcData.ach_account_number || <span className="text-muted-foreground">Not set</span>}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Routing Number</p>
                      <p className="text-sm font-mono">{pcData.ach_routing_number || <span className="text-muted-foreground">Not set</span>}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Beneficiary Address</p>
                      <p className="text-sm">{pcData.ach_beneficiary_address || <span className="text-muted-foreground">Not set</span>}</p>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Payment Email</p>
                    <p className="text-sm">{pcData.payment_email || <span className="text-muted-foreground">Not set</span>}</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>}

        {/* Remind & Review */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Reminds */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Bell className="w-4 h-4" />
                Reminds ({reminds.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {reminds.length > 0 && (
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {reminds.map(r => (
                    <div key={r.id} className="text-xs border rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{r.remind_date}</span>
                        <span className="text-muted-foreground">{r.author_name || '-'}</span>
                      </div>
                      {r.note && <p className="text-muted-foreground mt-0.5">{r.note}</p>}
                    </div>
                  ))}
                </div>
              )}
              <Separator />
              <div className="flex gap-2">
                <Input
                  type="date"
                  className="h-8 text-xs w-[130px]"
                  value={remindDate}
                  onChange={(e) => setRemindDate(e.target.value)}
                />
                <Input
                  placeholder="Note..."
                  className="h-8 text-xs flex-1"
                  value={remindNote}
                  onChange={(e) => setRemindNote(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddRemind()}
                />
                <Button size="sm" className="h-8" onClick={handleAddRemind} disabled={addingRemind}>
                  {addingRemind ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Reviews */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Reviews ({reviews.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {reviews.length > 0 && (
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {reviews.map(rv => (
                    <div key={rv.id} className="text-xs border rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{rv.review_date}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">{rv.author_name || '-'}</span>
                          <span className={cn(
                            'px-1.5 py-0.5 rounded text-[10px] font-medium',
                            rv.status === 'need_review' ? 'bg-red-100 text-red-700'
                              : rv.status === 'in_progress' ? 'bg-amber-100 text-amber-700'
                              : 'bg-emerald-100 text-emerald-700'
                          )}>
                            {rv.status === 'need_review' ? 'Need Review' : rv.status === 'in_progress' ? 'Info Requested' : 'Resolved'}
                          </span>
                        </div>
                      </div>
                      {rv.note && <p className="text-muted-foreground mt-0.5">{rv.note}</p>}
                      {rv.resolve_note && (
                        <p className={cn('mt-0.5', rv.status === 'resolved' ? 'text-emerald-600' : 'text-amber-600')}>
                          {rv.status === 'resolved' ? 'Resolved' : 'Info requested'}: {rv.resolve_note}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <Separator />
              <div className="flex gap-2">
                <Input
                  type="date"
                  className="h-8 text-xs w-[130px]"
                  value={reviewDate}
                  onChange={(e) => setReviewDate(e.target.value)}
                />
                <Input
                  placeholder="What needs review?"
                  className="h-8 text-xs flex-1"
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && reviewNote.trim() && handleAddReview()}
                />
                <Button size="sm" className="h-8" onClick={handleAddReview} disabled={addingReview || !reviewNote.trim()}>
                  {addingReview ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Shipping Info */}
        {(pcData.shipping_name || pcData.shipping_address || pcData.shipping_phone) && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="w-4 h-4" />
                Shipping Address
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Name</p>
                  <p className="text-sm">{pcData.shipping_name || <span className="text-muted-foreground">-</span>}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Address</p>
                  <p className="text-sm">{pcData.shipping_address || <span className="text-muted-foreground">-</span>}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Phone</p>
                  <p className="text-sm">{pcData.shipping_phone || <span className="text-muted-foreground">-</span>}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Signature Info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <PenLine className="w-4 h-4" />
              Agreement & Signature
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pcData.signed_at ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="default" className="bg-emerald-600 text-xs">Signed</Badge>
                  <span className="text-muted-foreground">
                    {new Date(pcData.signed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Legal Name</p>
                    <p className="text-sm font-medium">{pcData.legal_name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Signature</p>
                    {pcData.signature_url && (
                      <img
                        src={pcData.signature_url}
                        alt="Signature"
                        className="h-14 bg-white border rounded p-1"
                      />
                    )}
                  </div>
                </div>
                {pcData.contract_notes && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Additional Terms</p>
                    <p className="text-sm whitespace-pre-wrap bg-muted/50 rounded p-2">{pcData.contract_notes}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-center py-4 text-muted-foreground">
                  <PenLine className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Not yet signed</p>
                  <p className="text-xs mt-1">The creator has not signed the agreement yet.</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Additional Contract Terms</p>
                  <textarea
                    className="flex w-full rounded-md border px-3 py-2 text-sm bg-background min-h-[60px] resize-y"
                    placeholder="e.g. Including TikTok ads code and usage for our owned channels..."
                    defaultValue={pcData.contract_notes || ''}
                    onBlur={async (e) => {
                      const val = e.target.value.trim() || null;
                      if (val !== (pcData.contract_notes || null)) {
                        await supabase.from('project_creators').update({ contract_notes: val }).eq('id', pcData.id);
                        setPcData(prev => prev ? { ...prev, contract_notes: val } as PCFullData : prev);
                      }
                    }}
                  />
                  <p className="text-xs text-muted-foreground mt-1">These terms will appear in the contract. Auto-saves on blur.</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Assigned Products */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="w-4 h-4" />
                Assigned Products ({assignedProducts.length})
              </CardTitle>
              <Button variant="outline" size="sm" onClick={() => setShowProductPicker(true)}>
                <Plus className="w-3 h-3 mr-1" />
                Assign Product
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {assignedProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No products assigned yet. Click &quot;Assign Product&quot; to add products.
              </p>
            ) : (
              <div className="space-y-2">
                {assignedProducts.map((product) => (
                  <div
                    key={product.pcpId}
                    className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                  >
                    <div className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                      {product.thumbnail_url ? (
                        <img src={product.thumbnail_url} alt={product.name} className="w-full h-full object-cover" />
                      ) : (
                        <Package className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{product.name}</p>
                      {product.content_guide_url && (
                        <a
                          href={product.content_guide_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline flex items-center gap-1"
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
                          className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Product Link
                        </a>
                      )}
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="text-xs text-muted-foreground">Sample:</span>
                        <input
                          className="text-xs text-blue-600 bg-transparent border-b border-transparent hover:border-muted-foreground/30 focus:border-primary focus:outline-none px-0 py-0 flex-1 min-w-0"
                          defaultValue={(product as any).sample_invitation_url || ''}
                          placeholder="Paste sample invitation URL..."
                          onClick={(e) => e.stopPropagation()}
                          onBlur={async (e) => {
                            const val = e.target.value.trim() || null;
                            if (val !== ((product as any).sample_invitation_url || null)) {
                              await supabase.from('products').update({ sample_invitation_url: val }).eq('id', product.id);
                            }
                          }}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        />
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-7 h-7 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => handleRemoveProduct(product.pcpId)}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Payments Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <DollarSign className="w-5 h-5" />
              Payment Records
            </h2>
            {canAddPayment && (
              <Button size="sm" onClick={() => setShowAddPayment(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Payment
              </Button>
            )}
          </div>

          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      No payment records yet
                    </TableCell>
                  </TableRow>
                ) : (
                  payments.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell>
                        {new Date(payment.payment_date).toLocaleDateString('en-US', {
                          year: 'numeric', month: 'short', day: 'numeric'
                        })}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(Number(payment.amount))}
                      </TableCell>
                      <TableCell>
                        <p className="text-sm text-muted-foreground truncate max-w-[200px]">
                          {payment.note || '—'}
                        </p>
                      </TableCell>
                      <TableCell>
                        {payment.invoice_url ? (
                          <a
                            href={payment.invoice_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                          >
                            <FileText className="w-3 h-3" />
                            View
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      {canDelete && (
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="w-7 h-7 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDeletePayment(payment.id)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <Separator />

        {/* Videos Section */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Video className="w-5 h-5" />
            Submitted Videos ({activeVideos.length})
          </h2>

          {videos.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-center text-muted-foreground py-4">No videos submitted yet</p>
              </CardContent>
            </Card>
          ) : (
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>TikTok URL</TableHead>
                    <TableHead className="text-right">Views</TableHead>
                    <TableHead className="text-right">GMV</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-center">Spark Code</TableHead>
                    <TableHead className="text-center w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {videos.map((video) => (
                    <TableRow key={video.id} className={video.status === 'rejected' ? 'opacity-40 line-through' : ''}>
                      <TableCell>
                        <a
                          href={video.tiktok_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:underline flex items-center gap-1 max-w-[200px] truncate"
                        >
                          <ExternalLink className="w-3 h-3 flex-shrink-0" />
                          {video.tiktok_url.replace('https://www.tiktok.com/', '')}
                        </a>
                      </TableCell>
                      <TableCell className="text-right text-sm">{(video.view_count || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right text-sm">{video.gmv ? `$${Number(video.gmv).toLocaleString()}` : '-'}</TableCell>
                      <TableCell>
                        <Badge variant={video.status === 'rejected' ? 'destructive' : 'secondary'} className="text-xs">{video.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(video.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-6 h-6"
                          onClick={() => { navigator.clipboard.writeText(video.spark_ad_code); }}
                          title={video.spark_ad_code}
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                      </TableCell>
                      <TableCell className="text-center">
                        {video.status !== 'rejected' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={async () => {
                              if (!confirm('Reject this video? The creator will need to submit a replacement.')) return;
                              await supabase.from('videos').update({ status: 'rejected' }).eq('id', video.id);
                              setVideos(prev => prev.map(v => v.id === video.id ? { ...v, status: 'rejected' } : v));
                            }}
                          >
                            <X className="w-3 h-3 mr-0.5" />
                            Reject
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">rejected</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      {/* Add Payment Dialog */}
      <Dialog open={showAddPayment} onOpenChange={setShowAddPayment}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Payment Record</DialogTitle>
            <DialogDescription>
              Record a payment for {creator.name}. Contract: {formatCurrency(contractAmount)}, Balance: {formatCurrency(balance)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="pay-amount">Amount ($) <span className="text-destructive">*</span></Label>
                <Input
                  id="pay-amount"
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0.00"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm(prev => ({ ...prev, amount: e.target.value }))}
                  disabled={addingPayment}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pay-date">Payment Date</Label>
                <Input
                  id="pay-date"
                  type="date"
                  value={paymentForm.payment_date}
                  onChange={(e) => setPaymentForm(prev => ({ ...prev, payment_date: e.target.value }))}
                  disabled={addingPayment}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pay-note">Note</Label>
              <Textarea
                id="pay-note"
                placeholder="e.g., First installment, Final payment..."
                value={paymentForm.note}
                onChange={(e) => setPaymentForm(prev => ({ ...prev, note: e.target.value }))}
                disabled={addingPayment}
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label>Invoice File (PDF or Image)</Label>
              <div className="flex items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,image/*"
                  className="hidden"
                  onChange={(e) => setInvoiceFile(e.target.files?.[0] || null)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={addingPayment}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {invoiceFile ? 'Change File' : 'Choose File'}
                </Button>
                {invoiceFile && (
                  <span className="text-sm text-muted-foreground truncate max-w-[200px]">
                    {invoiceFile.name}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Max 10MB. PDF, JPG, PNG, WebP, GIF</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddPayment(false)} disabled={addingPayment}>
              Cancel
            </Button>
            <Button
              onClick={handleAddPayment}
              disabled={addingPayment || !paymentForm.amount || parseFloat(paymentForm.amount) <= 0}
            >
              {addingPayment ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {uploadingInvoice ? 'Uploading...' : 'Saving...'}
                </>
              ) : (
                'Add Payment'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Product Picker Dialog */}
      <Dialog open={showProductPicker} onOpenChange={(open) => { setShowProductPicker(open); if (!open) setSelectedProductIds(new Set()); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Products</DialogTitle>
            <DialogDescription>
              Select products to assign to this creator.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {allProducts.filter((p) => !assignedProductIds.has(p.id)).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                {allProducts.length === 0
                  ? 'No products found for this brand. Add products on the brand page first.'
                  : 'All products are already assigned.'}
              </p>
            ) : (
              allProducts
                .filter((p) => !assignedProductIds.has(p.id))
                .map((product) => {
                  const isSelected = selectedProductIds.has(product.id);
                  return (
                    <button
                      key={product.id}
                      className={cn(
                        'w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left',
                        isSelected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                      )}
                      onClick={() => {
                        setSelectedProductIds(prev => {
                          const next = new Set(prev);
                          if (next.has(product.id)) next.delete(product.id);
                          else next.add(product.id);
                          return next;
                        });
                      }}
                      disabled={assigningProduct}
                    >
                      <div className={cn(
                        'w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors',
                        isSelected ? 'bg-primary border-primary' : 'border-muted-foreground/30'
                      )}>
                        {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                      </div>
                      <div className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                        {product.thumbnail_url ? (
                          <img src={product.thumbnail_url} alt={product.name} className="w-full h-full object-cover" />
                        ) : (
                          <Package className="w-4 h-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{product.name}</p>
                      </div>
                    </button>
                  );
                })
            )}
          </div>
          {selectedProductIds.size > 0 && (
            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedProductIds(new Set())} disabled={assigningProduct}>
                Clear
              </Button>
              <Button onClick={handleAssignProducts} disabled={assigningProduct}>
                {assigningProduct ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                Assign {selectedProductIds.size} Product{selectedProductIds.size > 1 ? 's' : ''}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      {/* Delete Creator Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <Trash2 className="w-5 h-5" />
              Delete Creator
            </DialogTitle>
            <DialogDescription className="pt-2 space-y-2">
              <span className="block">
                Remove <strong>{pcData?.creators?.name}</strong> from this project?
              </span>
              <span className="block text-destructive text-sm font-medium">
                All related videos and payment records will also be deleted. This cannot be undone.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)} disabled={deletingCreator}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteCreator} disabled={deletingCreator}>
              {deletingCreator ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Deleting...</>
              ) : (
                <><Trash2 className="w-4 h-4 mr-2" />Delete</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
