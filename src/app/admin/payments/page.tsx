'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ExternalLink, Plus, DollarSign, Banknote, Users, ImagePlus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
// Tabs removed - showing all payments in a single table
import { Separator } from '@/components/ui/separator';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
} from '@/components/ui/tooltip';

import { cn } from '@/lib/utils';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import { useUserRole } from '@/hooks/useUserRole';

interface PaymentCreatorRow {
  id: string;
  project_id: string;
  creator_id: string;
  advance_payment: number;
  remaining_payment: number;
  contract_amount: number;
  assigned_video_count: number;
  content_type: string;
  payment_email: string | null;
  payment_method: string;
  ach_account_name: string | null;
  ach_bank_name: string | null;
  ach_account_number: string | null;
  ach_beneficiary_address: string | null;
  ach_routing_number: string | null;
  signed_at: string | null;
  legal_name: string | null;
  creators: {
    id: string;
    name: string;
    tiktok_handle: string;
    email: string;
  };
  projects: {
    id: string;
    name: string;
    brand_id: string;
    brands: { id: string; name: string; slug: string };
  };
  payments: { id: string; amount: number; payment_date: string }[];
  videos: { id: string }[];
}

type PaymentType = 'advance' | 'remaining';

interface PaymentRowWithType extends PaymentCreatorRow {
  _paymentType: PaymentType;
}

export default function PaymentsPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowser();
  const { isAdmin } = useUserRole();

  const [loading, setLoading] = useState(true);
  const [allPaymentRows, setAllPaymentRows] = useState<PaymentRowWithType[]>([]);

  // Add Payment dialog
  const [paymentTarget, setPaymentTarget] = useState<PaymentCreatorRow | null>(null);
  const [paymentType, setPaymentType] = useState<PaymentType>('advance');
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    payment_date: new Date().toISOString().split('T')[0],
    note: '',
    payment_email: '',
  });
  const [addingPayment, setAddingPayment] = useState(false);

  // Invoice image
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [invoicePreview, setInvoicePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isAdmin) {
      router.replace('/admin/brands');
      return;
    }
    fetchData();
  }, [isAdmin]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('project_creators')
        .select(`
          id, project_id, creator_id,
          advance_payment, remaining_payment, contract_amount,
          assigned_video_count, content_type, payment_email,
          payment_method, ach_account_name, ach_bank_name, ach_account_number, ach_routing_number, ach_beneficiary_address,
          signed_at, legal_name,
          creators(id, name, tiktok_handle, email),
          projects(id, name, brand_id, brands(id, name, slug)),
          payments(id, amount, payment_date),
          videos(id)
        `)
        .not('signed_at', 'is', null)
        .or('is_deleted.is.null,is_deleted.eq.false');

      if (error) throw error;

      const allRows = data as unknown as PaymentCreatorRow[];
      const combined: PaymentRowWithType[] = [];

      // Advance: advance_payment > 0 AND total paid < advance_payment
      allRows.forEach((row) => {
        if (row.advance_payment > 0) {
          const totalPaid = (row.payments || []).reduce((sum, p) => sum + p.amount, 0);
          if (totalPaid < row.advance_payment) {
            combined.push({ ...row, _paymentType: 'advance' });
          }
        }
      });

      // Remaining: videos all uploaded AND remaining_payment > 0 AND total paid < contract_amount
      allRows.forEach((row) => {
        if (row.remaining_payment > 0) {
          const videoCount = (row.videos || []).length;
          if (videoCount >= row.assigned_video_count) {
            const totalPaid = (row.payments || []).reduce((sum, p) => sum + p.amount, 0);
            if (totalPaid < row.contract_amount) {
              combined.push({ ...row, _paymentType: 'remaining' });
            }
          }
        }
      });

      setAllPaymentRows(combined);
    } catch (error) {
      console.error('Error fetching payment data:', error);
    } finally {
      setLoading(false);
    }
  };

  const setInvoiceFromFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    setInvoiceFile(file);
    const url = URL.createObjectURL(file);
    setInvoicePreview(url);
  }, []);

  const clearInvoice = useCallback(() => {
    setInvoiceFile(null);
    if (invoicePreview) URL.revokeObjectURL(invoicePreview);
    setInvoicePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [invoicePreview]);

  const handleAddPayment = async () => {
    if (!paymentTarget || !paymentForm.amount) return;

    try {
      setAddingPayment(true);

      // Upload invoice image if present
      let invoiceUrl: string | null = null;
      if (invoiceFile) {
        const ext = invoiceFile.name.split('.').pop() || 'png';
        const path = `invoices/${paymentTarget.id}/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('invoices')
          .upload(path, invoiceFile, { upsert: true });
        if (!uploadError) {
          const { data: publicUrl } = supabase.storage.from('invoices').getPublicUrl(path);
          invoiceUrl = publicUrl.publicUrl;
        }
      }

      // Insert payment
      const { error: paymentError } = await supabase
        .from('payments')
        .insert({
          project_creator_id: paymentTarget.id,
          amount: parseFloat(paymentForm.amount),
          payment_date: paymentForm.payment_date,
          note: paymentForm.note.trim() || null,
          invoice_url: invoiceUrl,
        });

      if (paymentError) throw paymentError;

      // Update payment_email if changed
      if (paymentForm.payment_email.trim() && paymentForm.payment_email.trim() !== (paymentTarget.payment_email || '')) {
        await supabase
          .from('project_creators')
          .update({ payment_email: paymentForm.payment_email.trim() })
          .eq('id', paymentTarget.id);
      }

      setPaymentTarget(null);
      setPaymentForm({ amount: '', payment_date: new Date().toISOString().split('T')[0], note: '', payment_email: '' });
      clearInvoice();
      await fetchData();
    } catch (error) {
      console.error('Error adding payment:', error);
    } finally {
      setAddingPayment(false);
    }
  };

  const openPaymentDialog = (row: PaymentCreatorRow, type: PaymentType) => {
    const totalPaid = (row.payments || []).reduce((sum, p) => sum + p.amount, 0);
    const owed = type === 'advance'
      ? row.advance_payment - totalPaid
      : row.contract_amount - totalPaid;
    clearInvoice();
    setPaymentTarget(row);
    setPaymentType(type);
    setPaymentForm({
      amount: Math.max(0, owed).toString(),
      payment_date: new Date().toISOString().split('T')[0],
      note: type === 'advance' ? 'Advance payment' : 'Remaining payment',
      payment_email: row.payment_email || row.creators.email || '',
    });
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

  // Summary stats
  const totalCreators = allPaymentRows.length;
  const readyCount = allPaymentRows.filter(r => r.payment_method === 'ach' ? !!r.ach_account_name : !!r.payment_email).length;
  const totalOwed = allPaymentRows.reduce((sum, row) => {
    const totalPaid = (row.payments || []).reduce((s, p) => s + p.amount, 0);
    return sum + (row._paymentType === 'advance'
      ? row.advance_payment - totalPaid
      : row.contract_amount - totalPaid);
  }, 0);

  if (!isAdmin) return null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const renderTable = (rows: PaymentRowWithType[]) => (
    <div className="border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Brand / Project</TableHead>
            <TableHead>TikTok Handle</TableHead>
            <TableHead>Signed</TableHead>
            <TableHead>Payment Info</TableHead>
            <TableHead className="text-center">Videos</TableHead>
            <TableHead className="text-right">Contract</TableHead>
            <TableHead className="text-right">Advance</TableHead>
            <TableHead className="text-right">Remaining</TableHead>
            <TableHead className="text-right">Paid</TableHead>
            <TableHead className="text-center">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                No creators awaiting payment
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, idx) => {
              const totalPaid = (row.payments || []).reduce((s, p) => s + p.amount, 0);
              const owed = row._paymentType === 'advance'
                ? row.advance_payment - totalPaid
                : row.contract_amount - totalPaid;
              const brandSlug = row.projects?.brands?.slug;
              const hasPaymentInfo = row.payment_method === 'ach' ? !!row.ach_account_name : !!row.payment_email;
              const videoCount = (row.videos || []).length;

              return (
                <TableRow
                  key={`${row.id}-${row._paymentType}`}
                  className={cn(
                    'cursor-pointer',
                    hasPaymentInfo
                      ? 'bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/30'
                      : 'hover:bg-muted/50'
                  )}
                  onClick={() => router.push(`/admin/brands/${brandSlug || row.projects.brand_id}/projects/${row.project_id}/creators/${row.id}`)}
                >
                  <TableCell>
                    <Badge variant={row._paymentType === 'advance' ? 'default' : 'secondary'} className="text-xs">
                      {row._paymentType === 'advance' ? 'Advance' : 'Remaining'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium text-sm">{row.projects?.brands?.name}</p>
                      <p className="text-xs text-muted-foreground">{row.projects?.name}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <a
                      href={`https://www.tiktok.com/@${row.creators.tiktok_handle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-sm font-mono text-blue-600 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      @{row.creators.tiktok_handle}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </TableCell>
                  <TableCell>
                    {row.signed_at && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-200 bg-emerald-50">
                            Signed
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="text-xs space-y-0.5">
                            <p>{row.legal_name}</p>
                            <p>{new Date(row.signed_at).toLocaleDateString()}</p>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.payment_method === 'ach' ? (
                      row.ach_account_name ? (
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-blue-700 truncate max-w-[180px]">
                              ACH: {row.ach_bank_name}
                            </p>
                            <p className="text-[10px] text-muted-foreground truncate max-w-[180px]">
                              {row.ach_account_name}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <span className="text-sm text-red-400">ACH (incomplete)</span>
                      )
                    ) : row.payment_email ? (
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                        <p className="text-sm truncate max-w-[180px] font-medium text-emerald-700">
                          {row.payment_email}
                        </p>
                      </div>
                    ) : row.creators.email ? (
                      <p className="text-sm truncate max-w-[180px] text-muted-foreground">
                        {row.creators.email}
                        <span className="ml-1 text-[10px] text-amber-500">(creator)</span>
                      </p>
                    ) : (
                      <span className="text-sm text-red-400">Not set</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <span className={cn('text-sm', row._paymentType === 'remaining' && videoCount >= row.assigned_video_count && 'text-emerald-600 font-medium')}>
                      {videoCount}/{row.assigned_video_count}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-sm font-medium">{formatCurrency(row.contract_amount)}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-sm">{formatCurrency(row.advance_payment)}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-sm">{formatCurrency(row.remaining_payment)}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div>
                      <span className="text-sm font-medium text-emerald-600">{formatCurrency(totalPaid)}</span>
                      {owed > 0 && (
                        <p className="text-xs text-amber-600">owe: {formatCurrency(owed)}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        openPaymentDialog(row, row._paymentType);
                      }}
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      Pay
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        <div className="border-b bg-card">
          <div className="max-w-7xl mx-auto p-6">
            <div className="flex items-center gap-3">
              <Banknote className="w-6 h-6 text-primary" />
              <div>
                <h1 className="text-3xl font-bold">Payment Management</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Creators awaiting payment
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto p-6 space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 max-w-2xl">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Pending</CardTitle>
                  <Users className="w-4 h-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{totalCreators}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Email Ready</CardTitle>
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-emerald-600">{readyCount}<span className="text-sm font-normal text-muted-foreground ml-1">/ {totalCreators}</span></p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total Owed</CardTitle>
                  <DollarSign className="w-4 h-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-amber-600">{formatCurrency(totalOwed)}</p>
              </CardContent>
            </Card>
          </div>

          <Separator />

          {/* All Payments Table */}
          {renderTable(allPaymentRows)}
        </div>

        {/* Add Payment Dialog */}
        <Dialog open={!!paymentTarget} onOpenChange={(open) => { if (!open) { setPaymentTarget(null); clearInvoice(); } }}>
          <DialogContent
            onPaste={(e) => {
              const items = Array.from(e.clipboardData?.items || []);
              const imageItem = items.find(item => item.type.startsWith('image/'));
              if (imageItem) {
                const file = imageItem.getAsFile();
                if (file) setInvoiceFromFile(file);
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>Add Payment ({paymentType === 'advance' ? 'Advance' : 'Remaining'})</DialogTitle>
              <DialogDescription>
                {paymentTarget && (
                  <>
                    <span className="font-medium">@{paymentTarget.creators.tiktok_handle}</span>
                    {' · '}
                    {paymentTarget.projects?.brands?.name} / {paymentTarget.projects?.name}
                  </>
                )}
              </DialogDescription>
            </DialogHeader>

            {paymentTarget && (
              <div className="space-y-4">
                {/* Summary */}
                <div className="bg-muted/50 rounded-lg p-3 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Contract</span>
                    <span className="font-medium">{formatCurrency(paymentTarget.contract_amount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Advance</span>
                    <span>{formatCurrency(paymentTarget.advance_payment)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Remaining</span>
                    <span>{formatCurrency(paymentTarget.remaining_payment)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Already Paid</span>
                    <span className="text-emerald-600">
                      {formatCurrency((paymentTarget.payments || []).reduce((s, p) => s + p.amount, 0))}
                    </span>
                  </div>
                  <Separator />
                  <div className="flex justify-between font-medium">
                    <span>Still Owed ({paymentType === 'advance' ? 'Advance' : 'Total'})</span>
                    <span className="text-amber-600">
                      {formatCurrency(
                        paymentType === 'advance'
                          ? paymentTarget.advance_payment - (paymentTarget.payments || []).reduce((s, p) => s + p.amount, 0)
                          : paymentTarget.contract_amount - (paymentTarget.payments || []).reduce((s, p) => s + p.amount, 0)
                      )}
                    </span>
                  </div>
                </div>

                {paymentTarget.payment_method === 'ach' ? (
                  <div className="space-y-2">
                    <Label>Payment Method: ACH</Label>
                    <div className="bg-blue-50 dark:bg-blue-950/20 rounded-lg p-3 space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Account Name</span>
                        <span className="font-medium">{paymentTarget.ach_account_name || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Bank</span>
                        <span className="font-medium">{paymentTarget.ach_bank_name || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Account #</span>
                        <span className="font-medium font-mono">{paymentTarget.ach_account_number || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Routing #</span>
                        <span className="font-medium font-mono">{paymentTarget.ach_routing_number || 'N/A'}</span>
                      </div>
                      {paymentTarget.ach_beneficiary_address && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Address</span>
                          <span className="font-medium text-right max-w-[200px]">{paymentTarget.ach_beneficiary_address}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="pay-email">Payment Email (PayPal)</Label>
                    <Input
                      id="pay-email"
                      type="email"
                      value={paymentForm.payment_email}
                      onChange={(e) => setPaymentForm(prev => ({ ...prev, payment_email: e.target.value }))}
                      disabled={addingPayment}
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="pay-amount">Amount ($)</Label>
                  <Input
                    id="pay-amount"
                    type="number"
                    step="0.01"
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

                <div className="space-y-2">
                  <Label htmlFor="pay-note">Note (optional)</Label>
                  <Input
                    id="pay-note"
                    placeholder="e.g., PayPal transfer"
                    value={paymentForm.note}
                    onChange={(e) => setPaymentForm(prev => ({ ...prev, note: e.target.value }))}
                    disabled={addingPayment}
                  />
                </div>

                {/* Invoice Image */}
                <div className="space-y-2">
                  <Label>Invoice / Screenshot (optional)</Label>
                  {invoicePreview ? (
                    <div className="relative inline-block">
                      <img
                        src={invoicePreview}
                        alt="Invoice preview"
                        className="max-h-48 w-full object-contain rounded-lg border bg-muted/30"
                      />
                      <button
                        type="button"
                        onClick={clearInvoice}
                        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center transition-colors"
                        disabled={addingPayment}
                      >
                        <X className="w-3.5 h-3.5 text-white" />
                      </button>
                    </div>
                  ) : (
                    <div
                      className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
                      onClick={() => fileInputRef.current?.click()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const file = e.dataTransfer.files[0];
                        if (file) setInvoiceFromFile(file);
                      }}
                      onDragOver={(e) => e.preventDefault()}
                    >
                      <ImagePlus className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        Click to select file, or drag and drop
                      </p>
                      <p className="text-xs text-muted-foreground/70 mt-0.5">
                        or paste from clipboard with <kbd className="px-1 py-0.5 rounded border bg-muted text-[10px]">⌘V</kbd>
                      </p>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) setInvoiceFromFile(file);
                    }}
                  />
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setPaymentTarget(null)} disabled={addingPayment}>
                Cancel
              </Button>
              <Button onClick={handleAddPayment} disabled={addingPayment || !paymentForm.amount}>
                {addingPayment ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <DollarSign className="w-4 h-4 mr-2" />}
                Record Payment
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
