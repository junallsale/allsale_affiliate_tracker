'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Copy, Check, Loader2, Upload, Download, Video, Users, Target, TrendingUp, DollarSign, Wallet, Package, PenLine, Star, Search, Bell, X, RefreshCw, Mail, ExternalLink, Trash2, Link2, Send } from 'lucide-react';
import Papa from 'papaparse';

import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import { cn } from '@/lib/utils';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import { useUserRole } from '@/hooks/useUserRole';
import { useFavoriteProjects } from '@/hooks/useFavoriteProjects';
import type { Project, Creator, Product, ContentType } from '@/types/database';
import { generateSlug, getCreatorStatus, getProgressPercent } from '@/lib/utils';

interface PCWithDetails {
  id: string;
  project_id: string;
  creator_id: string;
  unique_slug: string;
  assigned_video_count: number;
  content_type: 'shoppable_video' | 'live_shopping';
  contract_amount: number;
  advance_payment: number;
  remaining_payment: number;
  status: string;
  legal_name: string | null;
  signature_url: string | null;
  signed_at: string | null;
  sample_shipped: boolean;
  contract_sent: boolean;
  payment_email: string | null;
  creator: Creator;
  videos: { id: string; view_count: number; gmv: number | null }[];
  payments: { id: string; amount: number }[];
  project_creator_reminds: { id: string; remind_date: string; note: string | null; author_name: string | null; created_at: string }[];
  project_creator_reviews: { id: string; review_date: string; note: string | null; status: string; author_name: string | null; resolve_note: string | null; created_at: string }[];
}

type FilterType = 'all' | 'in-progress' | 'completed' | 'not-started';

export default function ProjectDetailPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const brandId = params.brandId as string;

  const [project, setProject] = useState<Project | null>(null);
  const [projectCreators, setProjectCreators] = useState<PCWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');

  const [showAddCreator, setShowAddCreator] = useState(false);
  const [newCreatorForm, setNewCreatorForm] = useState({
    name: '',
    email: '',
    tiktok_handle: '',
    assigned_video_count: 1,
    content_type: 'shoppable_video' as ContentType,
    contract_amount: 0,
    advance_payment: 0,
    remaining_payment: 0,
    commission_rate: 0,
    contact_point: '',
    communication_link: '',
    payment_email: '',
  });
  const [addingCreator, setAddingCreator] = useState(false);

  const [showImportCsv, setShowImportCsv] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importProgress, setImportProgress] = useState(0);
  const [importing, setImporting] = useState(false);

  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // Remind dialog
  const [remindTarget, setRemindTarget] = useState<PCWithDetails | null>(null);
  const [remindForm, setRemindForm] = useState({ remind_date: new Date().toISOString().split('T')[0], note: '' });
  const [addingRemind, setAddingRemind] = useState(false);

  // Review dialog
  const [reviewTarget, setReviewTarget] = useState<PCWithDetails | null>(null);
  const [reviewForm, setReviewForm] = useState({ review_date: new Date().toISOString().split('T')[0], note: '' });
  const [addingReview, setAddingReview] = useState(false);
  const [resolveTarget, setResolveTarget] = useState<{ reviewId: string; pcId: string; newStatus?: 'resolved' | 'in_progress' } | null>(null);
  const [resolveNote, setResolveNote] = useState('');
  const [resolving, setResolving] = useState(false);

  // Video stats refresh
  const [refreshingStats, setRefreshingStats] = useState(false);
  const [refreshResult, setRefreshResult] = useState<string | null>(null);

  // Send email dialog
  const [emailTarget, setEmailTarget] = useState<PCWithDetails | null>(null);
  const [emailAccounts, setEmailAccounts] = useState<{ id: string; email: string }[]>([]);
  const [emailAccountId, setEmailAccountId] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  // Sample invitation links
  const [sampleLinks, setSampleLinks] = useState<{ id: string; url: string; label: string | null; total_quantity: number | null; used_count: number; expires_at: string | null; is_active: boolean }[]>([]);
  const [showAddSampleLink, setShowAddSampleLink] = useState(false);
  const [sampleLinkForm, setSampleLinkForm] = useState({ url: '', label: '', total_quantity: '', expires_at: '' });
  const [addingSampleLink, setAddingSampleLink] = useState(false);

  // Budget edit
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetValue, setBudgetValue] = useState('');

  // Project dates edit
  const [editingDates, setEditingDates] = useState(false);
  const [datesForm, setDatesForm] = useState({ start_date: '', end_date: '', submission_deadline: '' });

  // Brand products for assignment
  const [brandProducts, setBrandProducts] = useState<Product[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());

  const supabase = createSupabaseBrowser();
  const router = useRouter();
  const { isBrandViewer, isOperator } = useUserRole();
  const canManageCreators = !isBrandViewer && !isOperator;
  const { isFavorite, toggleFavorite } = useFavoriteProjects();

  // Fetch project and project creators
  useEffect(() => {
    fetchProjectData();
  }, []);

  const fetchProjectData = async () => {
    try {
      setLoading(true);

      // Fetch project
      const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .select('*, brands(id, name, slug)')
        .eq('id', projectId)
        .single();

      if (projectError) throw projectError;
      setProject(projectData);

      // Fetch project creators with creator, video, and payment details
      const { data: pcData, error: pcError } = await supabase
        .from('project_creators')
        .select('*, creator:creators(*), videos(id, view_count, gmv), payments(id, amount), project_creator_reminds(id, remind_date, note, author_name, created_at), project_creator_reviews(id, review_date, note, status, author_name, resolve_note, created_at)')
        .eq('project_id', projectId)
        .or('is_deleted.is.null,is_deleted.eq.false')
        .order('created_at', { ascending: false });

      if (pcError) throw pcError;
      setProjectCreators((pcData || []) as PCWithDetails[]);

      // Fetch brand products for assignment
      if (projectData) {
        const { data: productsData } = await supabase
          .from('products')
          .select('*')
          .eq('brand_id', projectData.brand_id)
          .order('name');
        setBrandProducts((productsData || []) as Product[]);
      }

      // Fetch sample invitation links
      const { data: linksData } = await supabase
        .from('sample_invitation_links')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (linksData) setSampleLinks(linksData);

      // Fetch email accounts
      const acctRes = await fetch('/api/email-accounts');
      if (acctRes.ok) {
        const accts = await acctRes.json();
        setEmailAccounts(accts);
        if (accts.length > 0) setEmailAccountId(accts[0].id);
      }
    } catch (error) {
      console.error('Error fetching project data:', error);
    } finally {
      setLoading(false);
    }
  };

  const openSendEmail = async (pc: PCWithDetails) => {
    setEmailTarget(pc);
    setEmailLoading(true);
    setEmailSent(false);
    try {
      const res = await fetch('/api/emails/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectCreatorId: pc.id, templateSlug: 'confirmed_welcome' }),
      });
      if (res.ok) {
        const draft = await res.json();
        setEmailSubject(draft.subject);
        setEmailBody(draft.bodyHtml);
      }
    } catch {}
    setEmailLoading(false);
  };

  const handleSendEmail = async () => {
    if (!emailTarget || !emailAccountId) return;
    setEmailSending(true);
    try {
      const toEmail = emailTarget.creator?.email || '';
      const res = await fetch('/api/emails/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailAccountId,
          to: toEmail,
          subject: emailSubject,
          bodyHtml: emailBody,
          projectCreatorId: emailTarget.id,
        }),
      });
      if (res.ok) setEmailSent(true);
    } catch {}
    setEmailSending(false);
  };

  const handleAddSampleLink = async () => {
    if (!sampleLinkForm.url.trim()) return;
    setAddingSampleLink(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/sample-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: sampleLinkForm.url,
          label: sampleLinkForm.label || null,
          total_quantity: sampleLinkForm.total_quantity ? parseInt(sampleLinkForm.total_quantity) : null,
          expires_at: sampleLinkForm.expires_at || null,
        }),
      });
      if (res.ok) {
        const newLink = await res.json();
        setSampleLinks(prev => [newLink, ...prev]);
        setSampleLinkForm({ url: '', label: '', total_quantity: '', expires_at: '' });
        setShowAddSampleLink(false);
      }
    } catch {}
    setAddingSampleLink(false);
  };

  const toggleSampleLinkActive = async (linkId: string, isActive: boolean) => {
    const res = await fetch(`/api/projects/${projectId}/sample-links`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: linkId, is_active: isActive }),
    });
    if (res.ok) {
      setSampleLinks(prev => prev.map(l => l.id === linkId ? { ...l, is_active: isActive } : l));
    }
  };

  const deleteSampleLink = async (linkId: string) => {
    const res = await fetch(`/api/projects/${projectId}/sample-links?id=${linkId}`, { method: 'DELETE' });
    if (res.ok) {
      setSampleLinks(prev => prev.filter(l => l.id !== linkId));
    }
  };

  const handleAddCreator = async () => {
    if (!newCreatorForm.tiktok_handle.trim()) return;

    try {
      setAddingCreator(true);
      const handle = newCreatorForm.tiktok_handle.trim().replace(/^@/, '');

      // Check if creator already exists by email or handle
      let creatorId: string;
      const { data: existingByEmail } = newCreatorForm.email.trim()
        ? await supabase.from('creators').select('id').eq('email', newCreatorForm.email.trim()).single()
        : { data: null };

      if (existingByEmail) {
        creatorId = existingByEmail.id;
      } else {
        const { data: existingByHandle } = await supabase
          .from('creators').select('id').eq('tiktok_handle', handle).single();

        if (existingByHandle) {
          creatorId = existingByHandle.id;
        } else {
          // Create new creator
          const { data: newCreator, error: createError } = await supabase
            .from('creators')
            .insert({
              name: newCreatorForm.name.trim() || handle,
              email: newCreatorForm.email.trim() || null,
              tiktok_handle: handle,
              slug: generateSlug(),
            })
            .select('id')
            .single();

          if (createError || !newCreator) {
            console.error('Error creating creator:', createError);
            return;
          }
          creatorId = newCreator.id;
        }
      }

      // Check if already assigned to this project
      const { data: existingPc } = await supabase
        .from('project_creators')
        .select('id')
        .eq('project_id', projectId)
        .eq('creator_id', creatorId)
        .single();

      if (existingPc) {
        alert('This creator is already added to this project.');
        return;
      }

      // Create project creator relationship
      const uniqueSlug = generateSlug();
      const { data: newPc, error: insertError } = await supabase
        .from('project_creators')
        .insert({
          project_id: projectId,
          creator_id: creatorId,
          unique_slug: uniqueSlug,
          assigned_video_count: newCreatorForm.assigned_video_count,
          content_type: newCreatorForm.content_type,
          contract_amount: newCreatorForm.contract_amount,
          advance_payment: newCreatorForm.advance_payment,
          remaining_payment: newCreatorForm.remaining_payment,
          commission_rate: newCreatorForm.commission_rate,
          contact_point: newCreatorForm.contact_point.trim() || null,
          communication_link: newCreatorForm.communication_link.trim() || null,
          payment_email: newCreatorForm.payment_email.trim() || null,
          status: 'pending',
          ...(newCreatorForm.contract_amount === 0 ? { contract_sent: true, signed_at: new Date().toISOString() } : {}),
        })
        .select('id')
        .single();

      if (insertError) throw insertError;

      // Assign selected products
      if (newPc && selectedProductIds.size > 0) {
        const productInserts = Array.from(selectedProductIds).map((productId) => ({
          project_creator_id: newPc.id,
          product_id: productId,
        }));
        await supabase.from('project_creator_products').insert(productInserts);
      }

      setNewCreatorForm({ name: '', email: '', tiktok_handle: '', assigned_video_count: 1, content_type: 'shoppable_video', contract_amount: 0, advance_payment: 0, remaining_payment: 0, commission_rate: 0, contact_point: '', communication_link: '', payment_email: '' });
      setSelectedProductIds(new Set());
      setShowAddCreator(false);
      await fetchProjectData();
    } catch (error) {
      console.error('Error adding creator:', error);
    } finally {
      setAddingCreator(false);
    }
  };

  const handleCsvImport = async () => {
    if (!csvFile) return;

    try {
      setImporting(true);
      setImportProgress(0);

      const text = await csvFile.text();
      const results = Papa.parse(text, { header: true, skipEmptyLines: true });

      // Build a map of product names to IDs for matching
      const productNameMap = new Map<string, string>();
      for (const p of brandProducts) {
        productNameMap.set(p.name.toLowerCase().trim(), p.id);
      }

      const rows = results.data as Record<string, string | undefined>[];
      const total = rows.length;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const handle = row.handle?.trim()?.replace(/^@/, '');

        if (!handle) continue;

        // Find or create creator
        let creatorId: string | null = null;

        const { data: existingCreator } = await supabase
          .from('creators')
          .select('id')
          .eq('tiktok_handle', handle)
          .single();

        if (existingCreator) {
          creatorId = existingCreator.id;
        } else {
          const { data: newCreator, error: createError } = await supabase
            .from('creators')
            .insert({
              name: row.name?.trim() || handle,
              email: row.email?.trim() || null,
              tiktok_handle: handle,
              slug: generateSlug(),
            })
            .select('id')
            .single();

          if (!createError && newCreator) {
            creatorId = newCreator.id;
          }
        }

        if (creatorId) {
          const { data: existingPc } = await supabase
            .from('project_creators')
            .select('id')
            .eq('project_id', projectId)
            .eq('creator_id', creatorId)
            .single();

          if (!existingPc) {
            const uniqueSlug = generateSlug();
            const assignedCount = parseInt(row.assigned_video_count || '1', 10) || 1;
            const contractAmt = parseFloat(row.contract_amount || '0') || 0;

            const contentType = row.content_type?.trim().toLowerCase() === 'live_shopping' ? 'live_shopping' : 'shoppable_video';

            const { data: newPc } = await supabase
              .from('project_creators')
              .insert({
                project_id: projectId,
                creator_id: creatorId,
                unique_slug: uniqueSlug,
                assigned_video_count: assignedCount,
                content_type: contentType,
                contract_amount: contractAmt,
                contact_point: row.contact_point?.trim() || null,
                communication_link: row.communication_link?.trim() || null,
                status: 'pending',
                ...(contractAmt === 0 ? { contract_sent: true, signed_at: new Date().toISOString() } : {}),
              })
              .select('id')
              .single();

            // Assign products if specified (comma-separated product names)
            if (newPc && row.products?.trim()) {
              const productNames = row.products.split(',').map((n) => n.trim().toLowerCase());
              const productInserts = productNames
                .map((name) => productNameMap.get(name))
                .filter(Boolean)
                .map((productId) => ({
                  project_creator_id: newPc.id,
                  product_id: productId!,
                }));
              if (productInserts.length > 0) {
                await supabase.from('project_creator_products').insert(productInserts);
              }
            }
          }
        }

        setImportProgress(((i + 1) / total) * 100);
      }

      setCsvFile(null);
      setShowImportCsv(false);
      setImportProgress(0);
      await fetchProjectData();
    } catch (error) {
      console.error('Error importing CSV:', error);
    } finally {
      setImporting(false);
    }
  };

  const handleToggleSampleShipped = async (pcId: string, value: boolean) => {
    try {
      const { error } = await supabase
        .from('project_creators')
        .update({ sample_shipped: value })
        .eq('id', pcId);
      if (error) throw error;
      setProjectCreators(prev =>
        prev.map(pc => pc.id === pcId ? { ...pc, sample_shipped: value } : pc)
      );
    } catch (error) {
      console.error('Error toggling sample shipped:', error);
    }
  };

  const handleToggleContractSent = async (pcId: string, value: boolean) => {
    try {
      const { error } = await supabase
        .from('project_creators')
        .update({ contract_sent: value, contract_sent_at: value ? new Date().toISOString() : null })
        .eq('id', pcId);
      if (error) throw error;
      setProjectCreators(prev =>
        prev.map(pc => pc.id === pcId ? { ...pc, contract_sent: value, contract_sent_at: value ? new Date().toISOString() : null } : pc)
      );
    } catch (error) {
      console.error('Error toggling contract sent:', error);
    }
  };

  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch (error) {
      console.error('Error copying URL:', error);
    }
  };

  const handleSaveDates = async () => {
    if (!project) return;
    const { error } = await supabase.from('projects').update({
      start_date: datesForm.start_date || null,
      end_date: datesForm.end_date || null,
      submission_deadline: datesForm.submission_deadline || null,
    }).eq('id', project.id);
    if (!error) {
      setProject(prev => prev ? {
        ...prev,
        start_date: datesForm.start_date || undefined,
        end_date: datesForm.end_date || undefined,
        submission_deadline: datesForm.submission_deadline || undefined,
      } : prev);
      setEditingDates(false);
    }
  };

  const handleSaveBudget = async () => {
    if (!project) return;
    const val = parseFloat(budgetValue) || 0;
    const { error } = await supabase.from('projects').update({ budget: val }).eq('id', project.id);
    if (!error) {
      setProject(prev => prev ? { ...prev, budget: val } : prev);
      setEditingBudget(false);
    }
  };

  const handleAddRemind = async () => {
    if (!remindTarget) return;
    try {
      setAddingRemind(true);
      const { data: { session } } = await supabase.auth.getSession();
      const authorName = session?.user?.email?.split('@')[0] || 'Unknown';
      const { error } = await supabase.from('project_creator_reminds').insert({
        project_creator_id: remindTarget.id,
        remind_date: remindForm.remind_date,
        note: remindForm.note.trim() || null,
        author_name: authorName,
      });
      if (error) throw error;
      // Update local state
      const newRemind = {
        id: crypto.randomUUID(),
        remind_date: remindForm.remind_date,
        note: remindForm.note.trim() || null,
        author_name: authorName,
        created_at: new Date().toISOString(),
      };
      setProjectCreators(prev => prev.map(pc =>
        pc.id === remindTarget.id
          ? { ...pc, project_creator_reminds: [...(pc.project_creator_reminds || []), newRemind] }
          : pc
      ));
      setRemindTarget(null);
      setRemindForm({ remind_date: new Date().toISOString().split('T')[0], note: '' });
    } catch (error) {
      console.error('Error adding remind:', error);
    } finally {
      setAddingRemind(false);
    }
  };

  const handleAddReview = async () => {
    if (!reviewTarget || !reviewForm.note.trim()) return;
    try {
      setAddingReview(true);
      const { data: { session } } = await supabase.auth.getSession();
      const authorName = session?.user?.email?.split('@')[0] || 'Unknown';
      const { error } = await supabase.from('project_creator_reviews').insert({
        project_creator_id: reviewTarget.id,
        review_date: reviewForm.review_date,
        note: reviewForm.note.trim(),
        status: 'need_review',
        author_name: authorName,
      });
      if (error) throw error;
      const newReview = {
        id: crypto.randomUUID(), review_date: reviewForm.review_date,
        note: reviewForm.note.trim(), status: 'need_review',
        author_name: authorName, resolve_note: null as string | null,
        created_at: new Date().toISOString(),
      };
      setProjectCreators(prev => prev.map(pc =>
        pc.id === reviewTarget.id
          ? { ...pc, project_creator_reviews: [...(pc.project_creator_reviews || []), newReview] }
          : pc
      ));
      setReviewForm({ review_date: new Date().toISOString().split('T')[0], note: '' });
    } catch (error) {
      console.error('Error adding review:', error);
    } finally {
      setAddingReview(false);
    }
  };

  const handleStatusChangeReview = async () => {
    if (!resolveTarget) return;
    try {
      setResolving(true);
      const newStatus = resolveTarget.newStatus || 'resolved';
      const { error } = await supabase.from('project_creator_reviews').update({
        status: newStatus, resolve_note: resolveNote.trim() || null,
      }).eq('id', resolveTarget.reviewId);
      if (!error) {
        const pc = projectCreators.find(p => p.id === resolveTarget.pcId);
        const review = pc?.project_creator_reviews?.find(rv => rv.id === resolveTarget.reviewId);
        const { data: { session } } = await supabase.auth.getSession();
        const currentUser = session?.user?.email?.split('@')[0] || 'Someone';

        if (review?.author_name && review.author_name !== currentUser) {
          await supabase.from('notifications').insert({
            recipient: review.author_name,
            type: newStatus === 'resolved' ? 'review_resolved' : 'review_info_requested',
            title: newStatus === 'resolved' ? `Review resolved by ${currentUser}` : `${currentUser} requested more info`,
            body: resolveNote.trim() || null,
            link: `/admin/brands/${brandId}/projects/${projectId}/creators/${resolveTarget.pcId}`,
          });
        }

        setProjectCreators(prev => prev.map(pc =>
          pc.id === resolveTarget.pcId
            ? { ...pc, project_creator_reviews: (pc.project_creator_reviews || []).map(rv =>
                rv.id === resolveTarget.reviewId ? { ...rv, status: newStatus, resolve_note: resolveNote.trim() || null } : rv
              ) }
            : pc
        ));
      }
      setResolveTarget(null);
      setResolveNote('');
    } catch (error) {
      console.error('Error resolving review:', error);
    } finally {
      setResolving(false);
    }
  };

  const handleReopenReview = async (reviewId: string, pcId: string) => {
    const { error } = await supabase.from('project_creator_reviews').update({ status: 'need_review' }).eq('id', reviewId);
    if (!error) {
      setProjectCreators(prev => prev.map(pc =>
        pc.id === pcId
          ? { ...pc, project_creator_reviews: (pc.project_creator_reviews || []).map(rv => rv.id === reviewId ? { ...rv, status: 'need_review' } : rv) }
          : pc
      ));
    }
  };

  const handleRefreshVideoStats = async () => {
    try {
      setRefreshingStats(true);
      setRefreshResult(null);
      const res = await fetch('/api/videos/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId }),
      });
      const data = await res.json();
      const msg = `Updated ${data.updated}/${data.total_videos} videos`;
      setRefreshResult(msg);
      await fetchProjectData();
      alert(`Video stats refreshed!\n${msg}`);
      setTimeout(() => setRefreshResult(null), 10000);
    } catch {
      setRefreshResult('Failed to refresh');
      alert('Failed to refresh video stats');
      setTimeout(() => setRefreshResult(null), 5000);
    } finally {
      setRefreshingStats(false);
    }
  };

  const handleDownloadCsvTemplate = () => {
    const productNames = brandProducts.map((p) => p.name).join(', ');
    const header = 'handle,name,email,assigned_video_count,content_type,contract_amount,contact_point,communication_link,products';
    const example1 = `@creator1,John Doe,john@email.com,3,shoppable_video,500,Instagram DM,https://ig.com/creator1,"${brandProducts[0]?.name || 'Product A'}"`;
    const example2 = `@creator2,Jane Smith,jane@email.com,2,live_shopping,300,Email,,`;
    const example3 = `@creator3,,,1,shoppable_video,0,,,`;
    const content = [header, example1, example2, example3].join('\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'creator_import_template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const filteredCreators = projectCreators.filter((pc) => {
    // Status filter based on video progress (not DB status)
    const uploaded = pc.videos.length;
    const assigned = pc.assigned_video_count;
    if (filter === 'completed' && !(assigned > 0 && uploaded >= assigned)) return false;
    if (filter === 'in-progress' && !(uploaded > 0 && uploaded < assigned)) return false;
    if (filter === 'not-started' && uploaded !== 0) return false;

    // Search filter
    if (search) {
      const q = search.toLowerCase();
      const fields: string[] = [
        pc.creator?.name || '',
        pc.creator?.tiktok_handle || '',
        pc.legal_name || '',
      ];
      // Only include sensitive fields for non-brand-viewers
      if (!isBrandViewer) {
        fields.push(pc.creator?.email || '', pc.payment_email || '');
      }
      if (!fields.some(f => f.toLowerCase().includes(q))) return false;
    }

    return true;
  });

  // Calculate stats
  const totalCreators = projectCreators.length;
  const videosAssigned = projectCreators.reduce((sum, pc) => sum + pc.assigned_video_count, 0);
  const videosUploaded = projectCreators.reduce((sum, pc) => sum + pc.videos.length, 0);
  const completionPercent = videosAssigned > 0 ? Math.round((videosUploaded / videosAssigned) * 100) : 0;
  const totalContractAmount = projectCreators.reduce((sum, pc) => sum + (pc.contract_amount || 0), 0);
  const totalPaidAmount = projectCreators.reduce(
    (sum, pc) => sum + (pc.payments || []).reduce((s, p) => s + p.amount, 0), 0
  );
  const totalBalance = totalContractAmount - totalPaidAmount;
  const totalVideoViews = projectCreators.reduce((sum, pc) => sum + pc.videos.reduce((s, v) => s + (v.view_count || 0), 0), 0);
  const totalVideoGmv = projectCreators.reduce((sum, pc) => sum + pc.videos.reduce((s, v) => s + (Number(v.gmv) || 0), 0), 0);
  const projectBudget = (project as any)?.budget || 0;
  const budgetUsagePercent = projectBudget > 0 ? Math.round((totalContractAmount / projectBudget) * 100) : 0;

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Project not found</p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        {/* Header */}
        <div className="border-b bg-card">
          <div className="max-w-7xl mx-auto p-6">
            <div className="flex items-center gap-4 mb-4">
              <Button variant="ghost" size="icon" asChild>
                <Link href={`/admin/brands/${brandId}`}>
                  <ArrowLeft className="w-4 h-4" />
                </Link>
              </Button>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-3xl font-bold">{project.name}</h1>
                  <button
                    onClick={() => {
                      const brand = (project as any).brands;
                      toggleFavorite({
                        id: project.id,
                        name: project.name,
                        brandSlug: brand?.slug || brandId,
                        brandName: brand?.name || '',
                      });
                    }}
                    className="p-1 rounded hover:bg-muted transition-colors"
                    title={isFavorite(project.id) ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <Star
                      className={cn(
                        'h-5 w-5',
                        isFavorite(project.id)
                          ? 'text-amber-400 fill-amber-400'
                          : 'text-muted-foreground/40 hover:text-muted-foreground'
                      )}
                    />
                  </button>
                </div>
                <button
                  className="text-sm text-muted-foreground mt-1 hover:text-foreground hover:underline transition-colors"
                  onClick={() => {
                    setDatesForm({
                      start_date: project.start_date || '',
                      end_date: project.end_date || '',
                      submission_deadline: project.submission_deadline || '',
                    });
                    setEditingDates(true);
                  }}
                >
                  {project.start_date && project.end_date
                    ? `${new Date(project.start_date).toLocaleDateString()} - ${new Date(project.end_date).toLocaleDateString()}`
                    : 'No date range'}
                  {project.submission_deadline && ` · Deadline: ${new Date(project.submission_deadline).toLocaleDateString()}`}
                </button>
                {/* Shipping address toggle */}
                <button
                  className={cn(
                    'mt-1 text-xs px-2 py-0.5 rounded-full border transition-colors',
                    (project as any).require_shipping_address
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'border-muted-foreground/20 text-muted-foreground hover:border-muted-foreground/40'
                  )}
                  onClick={async () => {
                    const newVal = !(project as any).require_shipping_address;
                    const { error } = await supabase.from('projects').update({ require_shipping_address: newVal }).eq('id', project.id);
                    if (!error) setProject(prev => prev ? { ...prev, require_shipping_address: newVal } as any : prev);
                  }}
                >
                  <Package className="w-3 h-3 inline mr-1" />
                  {(project as any).require_shipping_address ? 'Shipping Address: ON' : 'Shipping Address: OFF'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Sample Invitation Links */}
        {canManageCreators && (
          <div className="max-w-7xl mx-auto px-6 pt-4">
            <Card>
              <CardHeader className="py-3 px-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Link2 className="w-4 h-4" /> Sample Invitation Links
                    <Badge variant="secondary" className="text-xs">{sampleLinks.length}</Badge>
                  </CardTitle>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowAddSampleLink(true)}>
                    <Plus className="w-3 h-3 mr-1" /> Add Link
                  </Button>
                </div>
              </CardHeader>
              {sampleLinks.length > 0 && (
                <CardContent className="px-4 pb-3 pt-0">
                  <div className="space-y-2">
                    {sampleLinks.map(link => (
                      <div key={link.id} className="flex items-center gap-3 text-sm border rounded-lg px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate text-xs">
                              {link.label || link.url}
                            </a>
                            <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0" />
                          </div>
                          <div className="flex gap-3 text-xs text-muted-foreground mt-0.5">
                            {link.total_quantity != null && <span>Used: {link.used_count}/{link.total_quantity}</span>}
                            {link.expires_at && (
                              <span className={new Date(link.expires_at) < new Date() ? 'text-red-500' : ''}>
                                Expires: {new Date(link.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => toggleSampleLinkActive(link.id, !link.is_active)}
                          className={cn(
                            'text-xs px-2 py-0.5 rounded-full border transition-colors',
                            link.is_active ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'border-muted-foreground/20 text-muted-foreground'
                          )}
                        >
                          {link.is_active ? 'Active' : 'Inactive'}
                        </button>
                        <button onClick={() => deleteSampleLink(link.id)} className="text-muted-foreground hover:text-red-500">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          </div>
        )}

        <div className="max-w-7xl mx-auto p-6 space-y-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Creators</CardTitle>
                  <Users className="w-4 h-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent><p className="text-2xl font-bold">{totalCreators}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Videos</CardTitle>
                  <Video className="w-4 h-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent><p className="text-2xl font-bold">{videosUploaded}<span className="text-sm text-muted-foreground font-normal">/{videosAssigned}</span></p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Completion</CardTitle>
                  <TrendingUp className="w-4 h-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className={cn('text-2xl font-bold', completionPercent >= 80 ? 'text-emerald-600' : completionPercent >= 50 ? 'text-amber-600' : 'text-muted-foreground')}>{completionPercent}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total Views</CardTitle>
                  <TrendingUp className="w-4 h-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent><p className="text-2xl font-bold">{totalVideoViews.toLocaleString()}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Video GMV</CardTitle>
                  <DollarSign className="w-4 h-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent><p className="text-2xl font-bold text-emerald-600">{formatCurrency(totalVideoGmv)}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Contract Total</CardTitle>
                  <DollarSign className="w-4 h-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent><p className="text-2xl font-bold">{formatCurrency(totalContractAmount)}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Paid</CardTitle>
                  <Wallet className="w-4 h-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent><p className="text-2xl font-bold text-emerald-600">{formatCurrency(totalPaidAmount)}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Balance</CardTitle>
                  <DollarSign className="w-4 h-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent><p className={cn('text-2xl font-bold', totalBalance > 0 ? 'text-amber-600' : 'text-muted-foreground')}>{formatCurrency(totalBalance)}</p></CardContent>
            </Card>
            <Card className="cursor-pointer hover:border-primary/50" onClick={() => { setEditingBudget(true); setBudgetValue(String(projectBudget || '')); }}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Budget</CardTitle>
                  <Target className="w-4 h-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                {projectBudget > 0 ? (
                  <div>
                    <p className="text-2xl font-bold">{formatCurrency(projectBudget)}</p>
                    <p className={cn('text-xs font-medium', budgetUsagePercent > 100 ? 'text-red-600' : budgetUsagePercent >= 80 ? 'text-amber-600' : 'text-emerald-600')}>
                      {budgetUsagePercent}% used
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Click to set</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Separator />

          {/* Creators Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">Creators</h2>
              {canManageCreators && (
                <div className="flex gap-2 items-center">
                  {refreshResult && <span className="text-xs text-emerald-600">{refreshResult}</span>}
                  {refreshingStats && <span className="text-xs text-amber-600 animate-pulse">Do not leave this page</span>}
                  <Button variant="ghost" size="sm" onClick={handleRefreshVideoStats} disabled={refreshingStats}>
                    <RefreshCw className={cn('w-4 h-4 mr-2', refreshingStats && 'animate-spin')} />
                    {refreshingStats ? 'Refreshing...' : 'Refresh Stats'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleDownloadCsvTemplate}>
                    <Download className="w-4 h-4 mr-2" />
                    CSV Template
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowImportCsv(true)}>
                    <Upload className="w-4 h-4 mr-2" />
                    Import CSV
                  </Button>
                  <Button size="sm" onClick={() => setShowAddCreator(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Creator
                  </Button>
                </div>
              )}
            </div>

            {/* Search + Filter */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search creators..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 w-56 pl-8 text-sm"
                />
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex gap-2 flex-wrap">
              {(['all', 'in-progress', 'completed', 'not-started'] as FilterType[]).map((filterOption) => (
                <Button
                  key={filterOption}
                  variant={filter === filterOption ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setFilter(filterOption)}
                >
                  {filterOption === 'all'
                    ? 'All'
                    : filterOption === 'in-progress'
                      ? 'In Progress'
                      : filterOption === 'completed'
                        ? 'Completed'
                        : 'Not Started'}
                </Button>
              ))}
            </div>

            {/* Creators Table */}
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Creator</TableHead>
                    <TableHead className="text-center">Contract</TableHead>
                    <TableHead>Signed</TableHead>
                    <TableHead className="text-center">Sample</TableHead>
                    <TableHead>Progress</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Contract</TableHead>
                    <TableHead className="text-center">Adv.</TableHead>
                    <TableHead className="text-center">Final</TableHead>
                    <TableHead>Remind</TableHead>
                    <TableHead>Review</TableHead>
                    {canManageCreators && <TableHead>URL</TableHead>}
                    {canManageCreators && <TableHead className="text-center">Email</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCreators.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                        No creators found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredCreators.map((pc) => {
                      const progressPercent = getProgressPercent(pc.videos.length, pc.assigned_video_count);
                      const creatorStatus = getCreatorStatus(pc.videos.length, pc.assigned_video_count);
                      const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
                      const creatorUrl = `${baseUrl}/c/${pc.unique_slug}`;
                      const paidAmount = (pc.payments || []).reduce((s, p) => s + p.amount, 0);
                      const advancePaid = pc.advance_payment === 0 || paidAmount >= (pc.advance_payment || 0);
                      const remainingPaid = paidAmount >= (pc.contract_amount || 0) && (pc.contract_amount || 0) > 0;

                      return (
                        <TableRow
                          key={pc.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => router.push(`/admin/brands/${brandId}/projects/${projectId}/creators/${pc.id}`)}
                        >
                          <TableCell>
                            <div>
                              <p className="font-semibold">{pc.creator.name}</p>
                              {!isBrandViewer && <p className="text-xs text-muted-foreground">{pc.creator.email}</p>}
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!isBrandViewer) handleToggleContractSent(pc.id, !pc.contract_sent);
                              }}
                              disabled={isBrandViewer}
                              className={cn(
                                'w-5 h-5 rounded border-2 flex items-center justify-center transition-colors mx-auto',
                                pc.contract_sent
                                  ? 'bg-blue-500 border-blue-500'
                                  : 'border-muted-foreground/30 hover:border-muted-foreground/50',
                                isBrandViewer && 'cursor-not-allowed opacity-50'
                              )}
                            >
                              {pc.contract_sent && <Check className="w-3 h-3 text-white" />}
                            </button>
                          </TableCell>
                          <TableCell>
                            {pc.signed_at ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center gap-1.5 text-emerald-600">
                                    <PenLine className="w-3.5 h-3.5" />
                                    <span className="text-xs font-medium">{pc.legal_name}</span>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-xs">
                                  <div className="space-y-1 text-xs">
                                    <p>Signed: {new Date(pc.signed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</p>
                                    {pc.signature_url && (
                                      <img src={pc.signature_url} alt="Signature" className="h-10 bg-white rounded border" />
                                    )}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <Badge variant="outline" className="text-xs text-muted-foreground">
                                Unsigned
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!isBrandViewer) handleToggleSampleShipped(pc.id, !pc.sample_shipped);
                              }}
                              disabled={isBrandViewer}
                              className={cn(
                                'w-5 h-5 rounded border-2 flex items-center justify-center transition-colors mx-auto',
                                pc.sample_shipped
                                  ? 'bg-emerald-500 border-emerald-500'
                                  : 'border-muted-foreground/30 hover:border-muted-foreground/50',
                                isBrandViewer && 'cursor-not-allowed opacity-50'
                              )}
                            >
                              {pc.sample_shipped && <Check className="w-3 h-3 text-white" />}
                            </button>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <Progress value={progressPercent} className="w-24" />
                                <span className="text-xs text-muted-foreground">
                                  {pc.videos.length}/{pc.assigned_video_count}
                                </span>
                              </div>
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                                {pc.content_type === 'live_shopping' ? 'LIVE' : 'Video'}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={creatorStatus.variant}>{creatorStatus.label}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <p className="text-sm font-medium">{formatCurrency(pc.contract_amount || 0)}</p>
                          </TableCell>
                          <TableCell className="text-center">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className={cn(
                                  'w-5 h-5 rounded-full flex items-center justify-center mx-auto',
                                  advancePaid
                                    ? 'bg-emerald-500'
                                    : 'bg-muted-foreground/20'
                                )}>
                                  {advancePaid && <Check className="w-3 h-3 text-white" />}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs">
                                {advancePaid
                                  ? (pc.advance_payment === 0 ? 'No advance' : `Advance ${formatCurrency(pc.advance_payment)} paid`)
                                  : `Advance ${formatCurrency(pc.advance_payment)} unpaid`}
                              </TooltipContent>
                            </Tooltip>
                          </TableCell>
                          <TableCell className="text-center">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className={cn(
                                  'w-5 h-5 rounded-full flex items-center justify-center mx-auto',
                                  remainingPaid
                                    ? 'bg-emerald-500'
                                    : 'bg-muted-foreground/20'
                                )}>
                                  {remainingPaid && <Check className="w-3 h-3 text-white" />}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs">
                                {remainingPaid
                                  ? `Final ${formatCurrency(pc.remaining_payment)} paid`
                                  : `Final ${formatCurrency(pc.remaining_payment)} unpaid`}
                              </TooltipContent>
                            </Tooltip>
                          </TableCell>
                          <TableCell>
                            {(() => {
                              const reminds = (pc.project_creator_reminds || []).sort((a, b) => b.remind_date.localeCompare(a.remind_date));
                              const latest = reminds[0];
                              return (
                                <div className="flex items-center gap-1">
                                  {latest ? (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setRemindTarget(pc); }}
                                          className="text-xs text-left hover:bg-muted rounded px-1 py-0.5"
                                        >
                                          <span className="font-medium">{latest.remind_date.slice(5)}</span>
                                          {latest.note && <span className="text-muted-foreground ml-1 truncate max-w-[80px] inline-block align-bottom">{latest.note}</span>}
                                          {reminds.length > 1 && <span className="text-muted-foreground ml-1">+{reminds.length - 1}</span>}
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent side="left" className="max-w-xs">
                                        <div className="space-y-0.5 text-xs">
                                          {reminds.map(r => (
                                            <p key={r.id}>{r.remind_date}{r.note ? ` - ${r.note}` : ''} ({r.author_name || '-'})</p>
                                          ))}
                                        </div>
                                      </TooltipContent>
                                    </Tooltip>
                                  ) : (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setRemindTarget(pc); }}
                                      className="text-muted-foreground/40 hover:text-muted-foreground p-0.5 rounded hover:bg-muted transition-colors"
                                    >
                                      <Bell className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              );
                            })()}
                          </TableCell>
                          <TableCell>
                            {(() => {
                              const reviews = (pc.project_creator_reviews || []).filter(rv => rv.status === 'need_review');
                              return (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setReviewTarget(pc); }}
                                  className={cn(
                                    'text-xs text-left hover:bg-muted rounded px-1 py-0.5 transition-colors',
                                    reviews.length > 0 ? 'text-red-600' : 'text-muted-foreground/40 hover:text-muted-foreground'
                                  )}
                                >
                                  {reviews.length > 0 ? (
                                    <><span className="inline-block w-3 h-3 mr-0.5 align-middle">!</span>{reviews.length}</>
                                  ) : (
                                    <span className="text-xs">+</span>
                                  )}
                                </button>
                              );
                            })()}
                          </TableCell>
                          {canManageCreators && (
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="w-6 h-6"
                                      onClick={(e) => { e.stopPropagation(); handleCopyUrl(creatorUrl); }}
                                    >
                                      {copiedUrl === creatorUrl ? (
                                        <Check className="w-4 h-4 text-emerald-600" />
                                      ) : (
                                        <Copy className="w-4 h-4" />
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {copiedUrl === creatorUrl ? 'Copied!' : 'Copy submission URL'}
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                            </TableCell>
                          )}
                          {canManageCreators && (
                            <TableCell className="text-center">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="w-6 h-6"
                                onClick={(e) => { e.stopPropagation(); openSendEmail(pc); }}
                                title="Send Email"
                              >
                                <Mail className="w-4 h-4" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>

        {/* Add Creator Dialog */}
        <Dialog open={showAddCreator} onOpenChange={setShowAddCreator}>
          <DialogContent className="max-h-[90vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>Add Creator</DialogTitle>
              <DialogDescription>Add a new creator to this project. If the creator doesn&apos;t exist yet, they will be created automatically.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 overflow-y-auto flex-1 pr-1">
              <div className="space-y-2">
                <Label htmlFor="creator-name">Name</Label>
                <Input
                  id="creator-name"
                  placeholder="Creator name"
                  value={newCreatorForm.name}
                  onChange={(e) => setNewCreatorForm((prev) => ({ ...prev, name: e.target.value }))}
                  disabled={addingCreator}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="creator-email">Email</Label>
                <Input
                  id="creator-email"
                  type="email"
                  placeholder="creator@example.com"
                  value={newCreatorForm.email}
                  onChange={(e) => setNewCreatorForm((prev) => ({ ...prev, email: e.target.value }))}
                  disabled={addingCreator}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="creator-handle">TikTok Handle <span className="text-destructive">*</span></Label>
                <Input
                  id="creator-handle"
                  placeholder="@username"
                  value={newCreatorForm.tiktok_handle}
                  onChange={(e) => setNewCreatorForm((prev) => ({ ...prev, tiktok_handle: e.target.value }))}
                  disabled={addingCreator}
                />
              </div>
              {/* Content Type */}
              <div className="space-y-2">
                <Label>Content Type</Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={cn(
                      'flex-1 rounded-lg border-2 px-3 py-2.5 text-sm font-medium transition-colors text-left',
                      newCreatorForm.content_type === 'shoppable_video'
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-muted hover:border-muted-foreground/30 text-muted-foreground'
                    )}
                    onClick={() => setNewCreatorForm((prev) => ({ ...prev, content_type: 'shoppable_video' }))}
                    disabled={addingCreator}
                  >
                    <div className="flex items-center gap-2">
                      <Video className="w-4 h-4" />
                      Shoppable Video
                    </div>
                    <p className="text-xs font-normal mt-0.5 opacity-70">Short-form video</p>
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'flex-1 rounded-lg border-2 px-3 py-2.5 text-sm font-medium transition-colors text-left',
                      newCreatorForm.content_type === 'live_shopping'
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-muted hover:border-muted-foreground/30 text-muted-foreground'
                    )}
                    onClick={() => setNewCreatorForm((prev) => ({ ...prev, content_type: 'live_shopping' }))}
                    disabled={addingCreator}
                  >
                    <div className="flex items-center gap-2">
                      <Target className="w-4 h-4" />
                      LIVE Shopping
                    </div>
                    <p className="text-xs font-normal mt-0.5 opacity-70">Live session</p>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="creator-videos">
                    {newCreatorForm.content_type === 'live_shopping' ? 'Assigned LIVE Sessions' : 'Assigned Videos'}
                  </Label>
                  <Input
                    id="creator-videos"
                    type="number"
                    min={1}
                    value={newCreatorForm.assigned_video_count}
                    onChange={(e) => setNewCreatorForm((prev) => ({ ...prev, assigned_video_count: parseInt(e.target.value, 10) || 1 }))}
                    disabled={addingCreator}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="creator-contract">Contract Amount ($)</Label>
                  <Input
                    id="creator-contract"
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    value={newCreatorForm.contract_amount || ''}
                    onChange={(e) => {
                      const amount = parseFloat(e.target.value) || 0;
                      setNewCreatorForm((prev) => ({
                        ...prev,
                        contract_amount: amount,
                        advance_payment: Math.round(amount * 50) / 100,
                        remaining_payment: Math.round(amount * 50) / 100,
                      }));
                    }}
                    disabled={addingCreator}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="creator-advance">Advance Payment ($)</Label>
                  <Input
                    id="creator-advance"
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    value={newCreatorForm.advance_payment || ''}
                    onChange={(e) => setNewCreatorForm((prev) => ({ ...prev, advance_payment: parseFloat(e.target.value) || 0 }))}
                    disabled={addingCreator}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="creator-remaining">Remaining Payment ($)</Label>
                  <Input
                    id="creator-remaining"
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    value={newCreatorForm.remaining_payment || ''}
                    onChange={(e) => setNewCreatorForm((prev) => ({ ...prev, remaining_payment: parseFloat(e.target.value) || 0 }))}
                    disabled={addingCreator}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="creator-commission">Commission Rate (% of GMV)</Label>
                <Input
                  id="creator-commission"
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  placeholder="e.g. 10"
                  value={newCreatorForm.commission_rate || ''}
                  onChange={(e) => setNewCreatorForm((prev) => ({ ...prev, commission_rate: parseFloat(e.target.value) || 0 }))}
                  disabled={addingCreator}
                />
                <p className="text-xs text-muted-foreground">Commission % on TikTok Shop sales from shoppable videos (3 months)</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="creator-contact">Contact Point (optional)</Label>
                <Input
                  id="creator-contact"
                  placeholder="e.g. Instagram DM, Email, etc."
                  value={newCreatorForm.contact_point}
                  onChange={(e) => setNewCreatorForm((prev) => ({ ...prev, contact_point: e.target.value }))}
                  disabled={addingCreator}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="creator-comm-link">Communication Link (optional)</Label>
                <Input
                  id="creator-comm-link"
                  type="url"
                  placeholder="https://..."
                  value={newCreatorForm.communication_link}
                  onChange={(e) => setNewCreatorForm((prev) => ({ ...prev, communication_link: e.target.value }))}
                  disabled={addingCreator}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="creator-payment-email">Payment Email (optional)</Label>
                <Input
                  id="creator-payment-email"
                  type="email"
                  placeholder="paypal@example.com"
                  value={newCreatorForm.payment_email}
                  onChange={(e) => setNewCreatorForm((prev) => ({ ...prev, payment_email: e.target.value }))}
                  disabled={addingCreator}
                />
                <p className="text-xs text-muted-foreground">Email for receiving payment (e.g., PayPal)</p>
              </div>

              {/* Product Assignment */}
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5" />
                  Assign Products (optional)
                </Label>
                {brandProducts.length === 0 ? (
                  <p className="text-xs text-muted-foreground border rounded-lg px-3 py-4 text-center">
                    No products registered for this brand yet.
                    <br />
                    <Link href={`/admin/brands/${brandId}`} className="text-blue-600 hover:underline">
                      Go to Brand page to add products first.
                    </Link>
                  </p>
                ) : (
                  <>
                    <div className="border rounded-lg max-h-[160px] overflow-y-auto divide-y">
                      {brandProducts.map((product) => {
                        const isSelected = selectedProductIds.has(product.id);
                        return (
                          <button
                            key={product.id}
                            type="button"
                            className={cn(
                              'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors',
                              isSelected ? 'bg-primary/5' : 'hover:bg-muted/50'
                            )}
                            onClick={() => {
                              setSelectedProductIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(product.id)) next.delete(product.id);
                                else next.add(product.id);
                                return next;
                              });
                            }}
                            disabled={addingCreator}
                          >
                            <div className={cn(
                              'w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors',
                              isSelected ? 'bg-primary border-primary' : 'border-muted-foreground/30'
                            )}>
                              {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                            </div>
                            <div className="w-7 h-7 rounded bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                              {product.thumbnail_url ? (
                                <img src={product.thumbnail_url} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <Package className="w-3 h-3 text-muted-foreground" />
                              )}
                            </div>
                            <span className="text-sm truncate">{product.name}</span>
                          </button>
                        );
                      })}
                    </div>
                    {selectedProductIds.size > 0 && (
                      <p className="text-xs text-muted-foreground">{selectedProductIds.size} product(s) selected</p>
                    )}
                  </>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddCreator(false)} disabled={addingCreator}>
                Cancel
              </Button>
              <Button onClick={handleAddCreator} disabled={addingCreator || !newCreatorForm.tiktok_handle.trim()}>
                {addingCreator ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Adding...
                  </>
                ) : (
                  'Add Creator'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Review Dialog */}
        <Dialog open={!!reviewTarget} onOpenChange={(open) => { if (!open) setReviewTarget(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Review</DialogTitle>
              <DialogDescription>
                {reviewTarget && <span className="font-medium">@{reviewTarget.creator.tiktok_handle}</span>}
              </DialogDescription>
            </DialogHeader>
            {reviewTarget && (
              <div className="space-y-4">
                {(reviewTarget.project_creator_reviews || []).length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">History</p>
                    <div className="border rounded-lg divide-y max-h-40 overflow-y-auto">
                      {[...(reviewTarget.project_creator_reviews || [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(rv => (
                        <div key={rv.id} className="px-3 py-1.5 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{rv.review_date}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">{rv.author_name || '-'}</span>
                              {rv.status === 'need_review' ? (
                                <div className="flex gap-1">
                                  <button
                                    onClick={() => { setResolveTarget({ reviewId: rv.id, pcId: reviewTarget.id, newStatus: 'in_progress' }); setResolveNote(''); }}
                                    className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
                                  >Request Info</button>
                                  <button
                                    onClick={() => { setResolveTarget({ reviewId: rv.id, pcId: reviewTarget.id, newStatus: 'resolved' }); setResolveNote(''); }}
                                    className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors"
                                  >Resolve</button>
                                </div>
                              ) : rv.status === 'in_progress' ? (
                                <button
                                  onClick={() => { setResolveTarget({ reviewId: rv.id, pcId: reviewTarget.id, newStatus: 'resolved' }); setResolveNote(''); }}
                                  className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
                                >Info Requested</button>
                              ) : (
                                <button
                                  onClick={() => handleReopenReview(rv.id, reviewTarget.id)}
                                  className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors"
                                >Resolved</button>
                              )}
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
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input type="date" value={reviewForm.review_date} onChange={(e) => setReviewForm(prev => ({ ...prev, review_date: e.target.value }))} disabled={addingReview} />
                </div>
                <div className="space-y-2">
                  <Label>Note <span className="text-destructive">*</span></Label>
                  <Input placeholder="What needs to be reviewed?" value={reviewForm.note} onChange={(e) => setReviewForm(prev => ({ ...prev, note: e.target.value }))} disabled={addingReview} />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setReviewTarget(null)} disabled={addingReview}>Cancel</Button>
              <Button onClick={handleAddReview} disabled={addingReview || !reviewForm.note.trim()}>
                {addingReview ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Add Review
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Status Change Dialog (Resolve / Request Info) */}
        <Dialog open={!!resolveTarget} onOpenChange={(open) => { if (!open) setResolveTarget(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{resolveTarget?.newStatus === 'in_progress' ? 'Request More Info' : 'Resolve Review'}</DialogTitle>
              <DialogDescription>
                {resolveTarget?.newStatus === 'in_progress' ? 'What additional information do you need?' : 'What was done to resolve this?'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>{resolveTarget?.newStatus === 'in_progress' ? 'Request Note' : 'Resolution Note'}</Label>
                <Input
                  placeholder={resolveTarget?.newStatus === 'in_progress' ? 'e.g., need shipping address...' : 'e.g., sent new contract, issue fixed...'}
                  value={resolveNote}
                  onChange={(e) => setResolveNote(e.target.value)}
                  disabled={resolving}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') handleStatusChangeReview(); }}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setResolveTarget(null)} disabled={resolving}>Cancel</Button>
              <Button onClick={handleStatusChangeReview} disabled={resolving}>
                {resolving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
                {resolveTarget?.newStatus === 'in_progress' ? 'Request Info' : 'Resolve'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Dates Dialog */}
        <Dialog open={editingDates} onOpenChange={setEditingDates}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Edit Project Dates</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input
                    type="date"
                    value={datesForm.start_date}
                    onChange={(e) => setDatesForm(prev => ({ ...prev, start_date: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <Input
                    type="date"
                    value={datesForm.end_date}
                    onChange={(e) => setDatesForm(prev => ({ ...prev, end_date: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Upload Deadline</Label>
                <Input
                  type="date"
                  value={datesForm.submission_deadline}
                  onChange={(e) => setDatesForm(prev => ({ ...prev, submission_deadline: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">This date appears in the creator contract</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingDates(false)}>Cancel</Button>
              <Button onClick={handleSaveDates}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Budget Dialog */}
        <Dialog open={editingBudget} onOpenChange={setEditingBudget}>
          <DialogContent className="max-w-xs">
            <DialogHeader>
              <DialogTitle>Set Project Budget</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Budget ($)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="e.g., 10000"
                  value={budgetValue}
                  onChange={(e) => setBudgetValue(e.target.value)}
                  autoFocus
                />
              </div>
              {projectBudget > 0 && (
                <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Contract Total</span>
                    <span className="font-medium">{formatCurrency(totalContractAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Budget Usage</span>
                    <span className={cn('font-medium', budgetUsagePercent > 100 ? 'text-red-600' : 'text-emerald-600')}>{budgetUsagePercent}%</span>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingBudget(false)}>Cancel</Button>
              <Button onClick={handleSaveBudget}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Remind Dialog */}
        <Dialog open={!!remindTarget} onOpenChange={(open) => { if (!open) setRemindTarget(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Add Remind</DialogTitle>
              <DialogDescription>
                {remindTarget && <span className="font-medium">@{remindTarget.creator.tiktok_handle}</span>}
              </DialogDescription>
            </DialogHeader>
            {remindTarget && (
              <div className="space-y-4">
                {/* Existing reminds */}
                {(remindTarget.project_creator_reminds || []).length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">History</p>
                    <div className="border rounded-lg divide-y max-h-32 overflow-y-auto">
                      {[...(remindTarget.project_creator_reminds || [])]
                        .sort((a, b) => b.remind_date.localeCompare(a.remind_date))
                        .map(r => (
                          <div key={r.id} className="px-3 py-1.5 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="font-medium">{r.remind_date}</span>
                              <span className="text-muted-foreground">{r.author_name || '-'}</span>
                            </div>
                            {r.note && <p className="text-muted-foreground mt-0.5">{r.note}</p>}
                          </div>
                        ))}
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={remindForm.remind_date}
                    onChange={(e) => setRemindForm(prev => ({ ...prev, remind_date: e.target.value }))}
                    disabled={addingRemind}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Note</Label>
                  <Input
                    placeholder="e.g., sign remind sent via email"
                    value={remindForm.note}
                    onChange={(e) => setRemindForm(prev => ({ ...prev, note: e.target.value }))}
                    disabled={addingRemind}
                  />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setRemindTarget(null)} disabled={addingRemind}>Cancel</Button>
              <Button onClick={handleAddRemind} disabled={addingRemind || !remindForm.remind_date}>
                {addingRemind ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Bell className="w-4 h-4 mr-2" />}
                Add
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Import CSV Dialog */}
        <Dialog open={showImportCsv} onOpenChange={setShowImportCsv}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Import Creators from CSV</DialogTitle>
              <DialogDescription>Upload a CSV file with creator TikTok handles</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <Card className="bg-muted/50 border-none">
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground mb-2 font-semibold">CSV Format (only handle is required):</p>
                  <pre className="text-xs bg-background p-2 rounded border overflow-x-auto whitespace-pre-wrap">
                    {`handle,name,email,assigned_video_count,contract_amount,contact_point,communication_link,products
@creator1,John Doe,john@email.com,3,500,Instagram DM,https://...,Product A
@creator2,Jane Smith,,2,300,Email,,`}
                  </pre>
                  <p className="text-xs text-muted-foreground mt-2">
                    <strong>products</strong>: comma-separated product names (must match brand product names exactly)
                  </p>
                  <Button variant="link" size="sm" className="px-0 h-auto text-xs" onClick={handleDownloadCsvTemplate}>
                    <Download className="w-3 h-3 mr-1" />
                    Download template
                  </Button>
                </CardContent>
              </Card>

              <div className="space-y-2">
                <Label htmlFor="csv-file">Choose File</Label>
                <Input
                  id="csv-file"
                  type="file"
                  accept=".csv"
                  onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                  disabled={importing}
                />
              </div>

              {importing && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Importing... {Math.round(importProgress)}%</p>
                  <Progress value={importProgress} />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowImportCsv(false)} disabled={importing}>
                Cancel
              </Button>
              <Button onClick={handleCsvImport} disabled={importing || !csvFile}>
                {importing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  'Import'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {/* Add Sample Link Dialog */}
        <Dialog open={showAddSampleLink} onOpenChange={setShowAddSampleLink}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Add Sample Invitation Link</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-sm">URL *</Label>
                <Input
                  value={sampleLinkForm.url}
                  onChange={(e) => setSampleLinkForm(f => ({ ...f, url: e.target.value }))}
                  placeholder="https://..."
                  className="mt-1 h-9"
                />
              </div>
              <div>
                <Label className="text-sm">Label</Label>
                <Input
                  value={sampleLinkForm.label}
                  onChange={(e) => setSampleLinkForm(f => ({ ...f, label: e.target.value }))}
                  placeholder="e.g. TikTok Shop Sample"
                  className="mt-1 h-9"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm">Quantity</Label>
                  <Input
                    type="number"
                    value={sampleLinkForm.total_quantity}
                    onChange={(e) => setSampleLinkForm(f => ({ ...f, total_quantity: e.target.value }))}
                    placeholder="Unlimited"
                    className="mt-1 h-9"
                  />
                </div>
                <div>
                  <Label className="text-sm">Expires</Label>
                  <Input
                    type="date"
                    value={sampleLinkForm.expires_at}
                    onChange={(e) => setSampleLinkForm(f => ({ ...f, expires_at: e.target.value }))}
                    className="mt-1 h-9"
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddSampleLink(false)}>Cancel</Button>
              <Button onClick={handleAddSampleLink} disabled={addingSampleLink || !sampleLinkForm.url}>
                {addingSampleLink ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Add Link
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Send Email Dialog */}
        <Dialog open={!!emailTarget} onOpenChange={(open) => { if (!open) { setEmailTarget(null); setEmailSent(false); } }}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Mail className="w-5 h-5" />
                Send Email — {emailTarget?.creator?.name || emailTarget?.creator?.tiktok_handle}
              </DialogTitle>
            </DialogHeader>
            {emailSent ? (
              <div className="text-center py-8">
                <Check className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
                <p className="text-lg font-semibold">Email Sent!</p>
                <p className="text-sm text-muted-foreground mt-1">to {emailTarget?.creator?.email}</p>
                <Button className="mt-4" onClick={() => { setEmailTarget(null); setEmailSent(false); }}>Close</Button>
              </div>
            ) : emailLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
            ) : (
              <>
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-medium">Send from</Label>
                    <select
                      className="flex h-9 w-full rounded-md border px-3 py-1 text-sm bg-background mt-1"
                      value={emailAccountId}
                      onChange={(e) => setEmailAccountId(e.target.value)}
                    >
                      {emailAccounts.length === 0 ? (
                        <option value="">No accounts connected</option>
                      ) : (
                        emailAccounts.map((a: any) => <option key={a.id} value={a.id}>{a.email}</option>)
                      )}
                    </select>
                    {emailAccounts.length === 0 && (
                      <p className="text-xs text-amber-600 mt-1">
                        <a href="/api/auth/gmail" className="underline">Connect a Gmail account</a> first
                      </p>
                    )}
                  </div>
                  <div>
                    <Label className="text-sm font-medium">To</Label>
                    <Input value={emailTarget?.creator?.email || 'No email'} disabled className="h-9 mt-1 bg-muted text-sm" />
                  </div>
                  <div>
                    <Label className="text-sm font-medium">Subject</Label>
                    <Input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} className="h-9 mt-1 text-sm" />
                  </div>
                  <div>
                    <Label className="text-sm font-medium">Body (HTML)</Label>
                    <textarea
                      value={emailBody}
                      onChange={(e) => setEmailBody(e.target.value)}
                      className="flex w-full rounded-md border px-3 py-2 text-sm bg-background mt-1 min-h-[200px] resize-y font-mono text-xs"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setEmailTarget(null)}>Cancel</Button>
                  <Button
                    onClick={handleSendEmail}
                    disabled={emailSending || !emailAccountId || !emailTarget?.creator?.email}
                  >
                    {emailSending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                    Send Email
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
