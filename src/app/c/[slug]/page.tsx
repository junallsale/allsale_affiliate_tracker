'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import { Loader2, CheckCircle2, Video, Eye, Heart, MessageCircle, Share2, ExternalLink, PenLine, Eraser, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

interface PCData {
  id: string;
  project_id: string;
  creator_id: string;
  unique_slug: string;
  assigned_video_count: number;
  content_type: 'shoppable_video' | 'live_shopping';
  contract_amount: number;
  advance_payment: number;
  remaining_payment: number;
  commission_rate: number;
  spark_ads_duration: number | null;
  contract_notes: string | null;
  payment_email: string | null;
  payment_method: string;
  status: string;
  legal_name: string | null;
  signature_url: string | null;
  signed_at: string | null;
  projects: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    submission_deadline: string | null;
    require_shipping_address: boolean;
    require_draft_review: boolean;
    brands: {
      id: string;
      name: string;
      logo_url: string | null;
    };
  };
  creators: {
    id: string;
    name: string;
    email: string | null;
    tiktok_handle: string | null;
    profile_image_url: string | null;
    bio: string | null;
  };
}

interface VideoData {
  id: string;
  project_creator_id: string;
  tiktok_url: string;
  tiktok_video_id: string | null;
  title: string | null;
  thumbnail_url: string | null;
  spark_ad_code: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
  status: string;
  created_at: string;
}

interface ProductData {
  id: string;
  name: string;
  thumbnail_url: string | null;
  content_guide_url: string | null;
  product_link: string | null;
}

// ── Signature Canvas Component ──
function SignatureCanvas({ onSave, onClear }: { onSave: (dataUrl: string) => void; onClear: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  const getPos = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if ('touches' in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!isDrawing) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    setHasDrawn(true);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
    onClear();
  };

  const saveSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return;
    const dataUrl = canvas.toDataURL('image/png');
    onSave(dataUrl);
  };

  return (
    <div className="space-y-3">
      <div className="border-2 border-dashed border-muted-foreground/30 rounded-lg overflow-hidden bg-white">
        <canvas
          ref={canvasRef}
          width={600}
          height={200}
          className="w-full cursor-crosshair touch-none"
          style={{ height: '150px' }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
      </div>
      <p className="text-xs text-muted-foreground text-center">Draw your signature above</p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={clearCanvas} className="flex-1">
          <Eraser className="w-4 h-4 mr-1" />
          Clear
        </Button>
        <Button type="button" size="sm" onClick={saveSignature} disabled={!hasDrawn} className="flex-1">
          <PenLine className="w-4 h-4 mr-1" />
          Confirm Signature
        </Button>
      </div>
    </div>
  );
}

// ── Main Page ──
export default function CreatorPublicPage() {
  const params = useParams();
  const slug = params?.slug as string;

  const supabase = useMemo(() => createSupabaseBrowser(), []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pcData, setPcData] = useState<PCData | null>(null);
  const [videos, setVideos] = useState<VideoData[]>([]);
  const [products, setProducts] = useState<ProductData[]>([]);

  // Signature state
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [legalName, setLegalName] = useState('');
  const [paymentEmail, setPaymentEmail] = useState('');
  const [achAccountName, setAchAccountName] = useState('');
  const [achBankName, setAchBankName] = useState('');
  const [achAccountNumber, setAchAccountNumber] = useState('');
  const [achBeneficiaryAddress, setAchBeneficiaryAddress] = useState('');
  const [achRoutingNumber, setAchRoutingNumber] = useState('');
  const [contractEmail, setContractEmail] = useState('');
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [signSubmitting, setSignSubmitting] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  // Shipping state
  const [shippingName, setShippingName] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [shippingPhone, setShippingPhone] = useState('');

  // Video submission state
  const [tiktokUrl, setTiktokUrl] = useState('');
  const [sparkAdCode, setSparkAdCode] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isSigned = !!(pcData?.signed_at);

  // Fetch data
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const { data: projectCreator, error: pcError } = await supabase
          .from('project_creators')
          .select('*, projects(*, brands(*)), creators(*)')
          .eq('unique_slug', slug)
          .or('is_deleted.is.null,is_deleted.eq.false')
          .single();

        if (pcError || !projectCreator) {
          throw new Error('Project not found');
        }

        setPcData(projectCreator as PCData);

        // Pre-fill payment email if already set
        if (projectCreator.payment_email) {
          setPaymentEmail(projectCreator.payment_email);
        }
        // Pre-fill contract email with creator's email
        const creatorEmail = (projectCreator as any).creator?.email || '';
        if (creatorEmail) setContractEmail(creatorEmail);

        // If not signed, show modal
        if (!projectCreator.legal_name || !projectCreator.signature_url) {
          setShowSignatureModal(true);
        }

        const { data: videosData } = await supabase
          .from('videos')
          .select('*')
          .eq('project_creator_id', projectCreator.id)
          .order('created_at', { ascending: false });

        setVideos((videosData as VideoData[]) || []);

        const { data: pcpData } = await supabase
          .from('project_creator_products')
          .select('*, products(*)')
          .eq('project_creator_id', projectCreator.id);

        if (pcpData) {
          const productsList = pcpData
            .map((pcp: { products?: ProductData }) => pcp.products)
            .filter(Boolean) as ProductData[];
          setProducts(productsList);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load project');
      } finally {
        setLoading(false);
      }
    };

    if (slug) fetchData();
  }, [slug, supabase]);

  // Upload signature image via server API (bypasses RLS)
  const handleSignatureSubmit = useCallback(async () => {
    if (!legalName.trim()) {
      setSignError('Please enter your legal name.');
      return;
    }
    const isAch = pcData?.payment_method === 'ach';
    const emailToUse = paymentEmail.trim() || pcData?.payment_email || '';
    if (!isAch && (!emailToUse || !/\S+@\S+\.\S+/.test(emailToUse))) {
      setSignError('Please enter a valid payment email.');
      return;
    }
    if (isAch && (!achAccountName.trim() || !achBankName.trim() || !achAccountNumber.trim())) {
      setSignError('Please fill in all bank details (account name, bank name, account number).');
      return;
    }
    if (!signatureDataUrl) {
      setSignError('Please draw your signature.');
      return;
    }
    if (!pcData) return;

    // Shipping validation if required
    const requireShipping = pcData.projects?.require_shipping_address;
    if (requireShipping) {
      if (!shippingName.trim()) { setSignError('Please enter the recipient name for shipping.'); return; }
      if (!shippingAddress.trim()) { setSignError('Please enter the shipping address.'); return; }
      if (!shippingPhone.trim()) { setSignError('Please enter a phone number for shipping.'); return; }
    }

    setSignSubmitting(true);
    setSignError(null);

    try {
      // Convert data URL to blob
      const res = await fetch(signatureDataUrl);
      const blob = await res.blob();

      const formData = new FormData();
      formData.append('project_creator_id', pcData.id);
      formData.append('legal_name', legalName.trim());
      formData.append('payment_method', pcData.payment_method || 'paypal');
      if (isAch) {
        formData.append('payment_email', '');
        formData.append('ach_account_name', achAccountName.trim());
        formData.append('ach_bank_name', achBankName.trim());
        formData.append('ach_account_number', achAccountNumber.trim());
        formData.append('ach_routing_number', achRoutingNumber.trim());
        formData.append('ach_beneficiary_address', achBeneficiaryAddress.trim());
      } else {
        formData.append('payment_email', emailToUse);
      }
      formData.append('contract_email', contractEmail.trim() || (isAch ? '' : emailToUse));
      formData.append('signature', blob, 'signature.png');
      if (requireShipping) {
        formData.append('shipping_name', shippingName.trim());
        formData.append('shipping_address', shippingAddress.trim());
        formData.append('shipping_phone', shippingPhone.trim());
      }

      const response = await fetch('/api/creator/sign', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to save signature');
      }

      const { signature_url } = await response.json();

      // Update local state
      setPcData(prev => prev ? {
        ...prev,
        legal_name: legalName.trim(),
        signature_url,
        signed_at: new Date().toISOString(),
      } : prev);

      setShowSignatureModal(false);
    } catch (err) {
      setSignError(err instanceof Error ? err.message : 'Failed to save signature');
    } finally {
      setSignSubmitting(false);
    }
  }, [legalName, paymentEmail, signatureDataUrl, pcData, shippingName, shippingAddress, shippingPhone, achAccountName, achBankName, achAccountNumber, achRoutingNumber, achBeneficiaryAddress]);

  // Handle video submission
  const handleSubmitVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(false);

    if (!tiktokUrl.trim()) {
      setSubmitError('TikTok URL is required');
      return;
    }
    if (!sparkAdCode.trim()) {
      setSubmitError('Spark Ad Code is required');
      return;
    }

    try {
      setSubmitting(true);
      const response = await fetch('/api/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_creator_id: pcData?.id,
          tiktok_url: tiktokUrl,
          spark_ad_code: sparkAdCode,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit video');
      }

      setSubmitSuccess(true);
      setTiktokUrl('');
      setSparkAdCode('');

      setTimeout(() => {
        location.reload();
      }, 1500);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit video');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-muted/50 to-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !pcData) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-muted/50 to-background flex items-center justify-center p-4">
        <Card className="w-full max-w-lg border-destructive">
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-destructive font-semibold mb-2">Error</p>
              <p className="text-sm text-muted-foreground">{error || 'Project not found'}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const project = pcData.projects;
  const creator = pcData.creators;
  const brand = project?.brands;
  const assignedCount = pcData.assigned_video_count || 1;
  const activeVideos = videos.filter(v => v.status !== 'rejected');
  const progressPercent = (activeVideos.length / assignedCount) * 100;
  const allVideosSubmitted = activeVideos.length >= assignedCount;
  const isLive = pcData.content_type === 'live_shopping';
  const contentLabel = isLive ? 'LIVE Sessions' : 'Videos';

  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/50 to-background py-8 px-4">
      <div className="w-full max-w-lg mx-auto space-y-6">

        {/* ── Signature Modal Overlay ── */}
        {showSignatureModal && !isSigned && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <Card className="w-full max-w-md max-h-[95vh] overflow-y-auto">
              <CardHeader className="text-center">
                <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                  <PenLine className="w-6 h-6 text-primary" />
                </div>
                <CardTitle className="text-lg">Agreement & Signature</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Please provide your legal name and signature before submitting videos.
                </p>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Contract Details */}
                <div className="p-3 rounded-lg border text-xs leading-relaxed space-y-3">
                  <p className="font-semibold text-sm">Contract Summary</p>

                  {/* Platform & Account */}
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Platform</span>
                      <span className="font-medium">TikTok</span>
                    </div>
                    {creator?.tiktok_handle && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Account</span>
                        <span className="font-medium">@{creator.tiktok_handle}</span>
                      </div>
                    )}
                    {brand && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Brand</span>
                        <span className="font-medium">{brand.name}</span>
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Deliverables */}
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Content Type</span>
                      <span className="font-medium">
                        {pcData?.content_type === 'live_shopping' ? 'LIVE Shopping' : 'Shoppable Video'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {pcData?.content_type === 'live_shopping' ? 'LIVE Sessions' : 'Shoppable Videos'}
                      </span>
                      <span className="font-medium">{pcData?.assigned_video_count || 0}</span>
                    </div>
                    {products.length > 0 && (
                      <div>
                        <span className="text-muted-foreground">Products:</span>
                        <ul className="mt-1 ml-3 space-y-0.5">
                          {products.map(p => (
                            <li key={p.id} className="font-medium">• {p.name}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {pcData?.projects?.submission_deadline && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Upload Deadline</span>
                        <span className="font-medium">{new Date(pcData.projects.submission_deadline).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Compensation */}
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Fee</span>
                      <span className="font-medium">${(pcData?.contract_amount || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Advance{(pcData?.contract_amount || 0) > 0 ? ` (${Math.round(((pcData?.advance_payment || 0) / pcData.contract_amount) * 100)}%)` : ''}
                      </span>
                      <span className="font-medium">${(pcData?.advance_payment || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Remaining{(pcData?.contract_amount || 0) > 0 ? ` (${Math.round(((pcData?.remaining_payment || 0) / pcData.contract_amount) * 100)}%)` : ''}
                      </span>
                      <span className="font-medium">${(pcData?.remaining_payment || 0).toLocaleString()}</span>
                    </div>
                    {(pcData?.commission_rate || 0) > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Commission</span>
                        <span className="font-medium">{pcData?.commission_rate}% of TikTok Shop GMV</span>
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Payment Terms */}
                  <div className="space-y-1 text-muted-foreground">
                    <p>• Advance: paid within 3 business days of signing</p>
                    <p>• Remaining: paid within 3 business days after all video post links are submitted</p>
                    <p>• Payment via {pcData?.payment_method === 'ach' ? 'ACH (Bank Transfer)' : 'PayPal'}</p>
                    <p>• Creator is responsible for any taxes or fees</p>
                  </div>

                  <Separator />

                  {/* Requirements */}
                  <div className="space-y-1 text-muted-foreground">
                    <p>• Tag the brand official account</p>
                    <p>• Spark Ads access: must share after posting{pcData?.spark_ads_duration ? ` (${pcData.spark_ads_duration} days)` : ''}</p>
                    {pcData?.projects?.require_draft_review && (
                      <>
                        <p className="font-bold text-foreground">• Creator must follow the content guidelines and submit a draft for review before posting</p>
                        <p className="font-bold text-foreground">• Up to 2 revisions per video are allowed</p>
                        {products.filter(p => p.content_guide_url).length > 0 && (
                          <div className="pl-3 space-y-0.5">
                            {products.filter(p => p.content_guide_url).map(p => (
                              <p key={p.id}>
                                <a href={p.content_guide_url!} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                                  {p.name} - Content Guide
                                </a>
                              </p>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                    {pcData?.contract_notes && (
                      <p>• {pcData.contract_notes}</p>
                    )}
                  </div>
                </div>

                {/* Agreement confirmation */}
                <div className="p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground leading-relaxed space-y-1">
                  <p>By signing below, I confirm that:</p>
                  <p>1. I agree to the above terms and will deliver the assigned {isLive ? 'LIVE shopping sessions' : 'shoppable video content'}.</p>
                  <p>2. The information I provide is accurate and truthful.</p>
                </div>

                {/* Legal Name */}
                <div className="space-y-2">
                  <Label htmlFor="legal-name" className="text-sm font-medium">
                    Legal Name (Full Name) <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="legal-name"
                    placeholder="Enter your full legal name"
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                  />
                </div>

                {/* Payment Details */}
                {pcData?.payment_method === 'ach' ? (
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">
                      Bank Account Details (ACH) <span className="text-destructive">*</span>
                    </Label>
                    <div className="text-xs text-muted-foreground p-2.5 rounded-md bg-muted/50">
                      <p>Payment will be sent via <strong>ACH bank transfer</strong>.</p>
                    </div>
                    <div className="space-y-2">
                      <Input
                        placeholder="Account Name (e.g. John Doe)"
                        value={achAccountName}
                        onChange={(e) => setAchAccountName(e.target.value)}
                      />
                      <Input
                        placeholder="Bank Name (e.g. Chase, Bank of America)"
                        value={achBankName}
                        onChange={(e) => setAchBankName(e.target.value)}
                      />
                      <Input
                        placeholder="Account Number"
                        value={achAccountNumber}
                        onChange={(e) => setAchAccountNumber(e.target.value)}
                      />
                      <Input
                        placeholder="Routing Number"
                        value={achRoutingNumber}
                        onChange={(e) => setAchRoutingNumber(e.target.value)}
                      />
                      <Input
                        placeholder="Beneficiary Address (full address)"
                        value={achBeneficiaryAddress}
                        onChange={(e) => setAchBeneficiaryAddress(e.target.value)}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="payment-email" className="text-sm font-medium">
                      Payment Email <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="payment-email"
                      type="email"
                      placeholder="your@email.com"
                      value={paymentEmail}
                      onChange={(e) => setPaymentEmail(e.target.value)}
                    />
                    <div className="text-xs text-muted-foreground space-y-1 p-2.5 rounded-md bg-muted/50">
                      <p>Payment will be sent via <strong>PayPal</strong> to this email address.</p>
                    </div>
                  </div>
                )}

                {/* Contract Email */}
                <div className="space-y-2">
                  <Label htmlFor="contract-email" className="text-sm font-medium">
                    Contract Email
                  </Label>
                  <Input
                    id="contract-email"
                    type="email"
                    placeholder="your@email.com"
                    value={contractEmail}
                    onChange={(e) => setContractEmail(e.target.value)}
                  />
                  <div className="text-xs text-muted-foreground p-2.5 rounded-md bg-muted/50">
                    <p>A signed copy of this agreement will be sent to this email address.</p>
                  </div>
                </div>

                {/* Shipping Address (if required) */}
                {pcData?.projects?.require_shipping_address && (
                  <div className="space-y-3 p-3 rounded-lg border border-blue-200 bg-blue-50/50">
                    <div>
                      <p className="text-sm font-medium text-blue-900">Shipping Address <span className="text-destructive">*</span></p>
                      <p className="text-xs text-blue-700 mt-0.5">
                        Our TikTok Shop setup is not yet complete. We need your shipping address to send product samples directly from our warehouse.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="shipping-name" className="text-sm">Recipient Name <span className="text-destructive">*</span></Label>
                      <Input
                        id="shipping-name"
                        placeholder="Full name"
                        value={shippingName}
                        onChange={(e) => setShippingName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="shipping-address" className="text-sm">Address <span className="text-destructive">*</span></Label>
                      <Input
                        id="shipping-address"
                        placeholder="Street address, city, state, zip code"
                        value={shippingAddress}
                        onChange={(e) => setShippingAddress(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="shipping-phone" className="text-sm">Phone Number <span className="text-destructive">*</span></Label>
                      <Input
                        id="shipping-phone"
                        type="tel"
                        placeholder="e.g., (555) 123-4567"
                        value={shippingPhone}
                        onChange={(e) => setShippingPhone(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {/* Signature Canvas */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Signature <span className="text-destructive">*</span></Label>
                  <SignatureCanvas
                    onSave={(dataUrl) => setSignatureDataUrl(dataUrl)}
                    onClear={() => setSignatureDataUrl(null)}
                  />
                  {signatureDataUrl && (
                    <p className="text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Signature captured
                    </p>
                  )}
                </div>

                {signError && (
                  <p className="text-sm text-destructive text-center">{signError}</p>
                )}

                <Button
                  className="w-full"
                  onClick={handleSignatureSubmit}
                  disabled={signSubmitting || !legalName.trim() || !signatureDataUrl || (pcData?.payment_method === 'ach' ? (!achAccountName.trim() || !achBankName.trim() || !achAccountNumber.trim()) : (!paymentEmail.trim() && !pcData?.payment_email)) || (pcData?.projects?.require_shipping_address && (!shippingName.trim() || !shippingAddress.trim() || !shippingPhone.trim()))}
                >
                  {signSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    'Submit Agreement'
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Header Card */}
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              {brand && (
                <div>
                  <Badge variant="secondary" className="text-xs">
                    {brand.name}
                  </Badge>
                </div>
              )}
              {project && (
                <h1 className="text-2xl font-bold">{project.name}</h1>
              )}
              {creator && (
                <div className="flex items-center gap-3">
                  {creator.profile_image_url && (
                    <img
                      src={creator.profile_image_url}
                      alt={creator.name}
                      className="w-12 h-12 rounded-full object-cover"
                    />
                  )}
                  <div>
                    <p className="font-semibold text-sm">{creator.name}</p>
                    {creator.tiktok_handle && (
                      <p className="text-xs text-muted-foreground">@{creator.tiktok_handle}</p>
                    )}
                  </div>
                </div>
              )}
              {/* Signed indicator */}
              {isSigned && (
                <div className="flex items-center gap-2 text-xs text-green-600 bg-green-50 dark:bg-green-950/30 rounded-lg px-3 py-2">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Signed by <strong>{pcData.legal_name}</strong> on {new Date(pcData.signed_at!).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Progress Card */}
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-3">
              <div className="flex justify-between items-center text-sm">
                <span className="font-medium">{contentLabel} Uploaded</span>
                <span className="text-muted-foreground">
                  {activeVideos.length} of {assignedCount}
                </span>
              </div>
              <Progress value={Math.min(progressPercent, 100)} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">
                {Math.round(progressPercent)}% complete
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Success State */}
        {allVideosSubmitted && (
          <Card className="border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900">
            <CardContent className="pt-6">
              <div className="text-center space-y-3">
                <CheckCircle2 className="w-12 h-12 text-green-600 dark:text-green-400 mx-auto" />
                <div>
                  <p className="font-semibold text-green-900 dark:text-green-100">
                    All videos submitted!
                  </p>
                  <p className="text-sm text-green-700 dark:text-green-200">
                    Thank you for your participation.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Products Section */}
        {products.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Video className="w-5 h-5" />
                Assigned Products
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {products.map(product => (
                  <div key={product.id} className="flex items-center gap-3 p-3 rounded-lg border">
                    <div className="w-12 h-12 rounded bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                      {product.thumbnail_url ? (
                        <img
                          src={product.thumbnail_url}
                          alt={product.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Video className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{product.name}</p>
                      {product.content_guide_url && (
                        <a
                          href={product.content_guide_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline flex items-center gap-1 mt-0.5"
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
                          className="text-xs text-blue-600 hover:underline flex items-center gap-1 mt-0.5"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Product Link
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Submit Form — only if signed and not all submitted */}
        {!allVideosSubmitted && isSigned && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Submit a Video</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmitVideo} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="tiktok-url" className="text-sm">TikTok URL</Label>
                  <Input
                    id="tiktok-url"
                    type="url"
                    placeholder="https://www.tiktok.com/..."
                    value={tiktokUrl}
                    onChange={(e) => setTiktokUrl(e.target.value)}
                    disabled={submitting}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="spark-code" className="text-sm">Spark Ad Code</Label>
                  <Input
                    id="spark-code"
                    type="text"
                    placeholder="e.g., ABC123XYZ"
                    value={sparkAdCode}
                    onChange={(e) => setSparkAdCode(e.target.value.toUpperCase())}
                    disabled={submitting}
                  />
                  <p className="text-xs text-muted-foreground">
                    Enter the Spark Ad authorization code from TikTok
                  </p>
                </div>

                {submitError && (
                  <p className="text-sm text-destructive font-medium">{submitError}</p>
                )}

                {submitSuccess && (
                  <p className="text-sm text-green-600 dark:text-green-400 font-medium">
                    Video submitted successfully!
                  </p>
                )}

                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    'Submit Video'
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Not signed yet notice (when modal is closed somehow) */}
        {!allVideosSubmitted && !isSigned && !showSignatureModal && (
          <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900">
            <CardContent className="pt-6">
              <div className="text-center space-y-3">
                <PenLine className="w-10 h-10 text-amber-600 dark:text-amber-400 mx-auto" />
                <div>
                  <p className="font-semibold text-amber-900 dark:text-amber-100">
                    Signature Required
                  </p>
                  <p className="text-sm text-amber-700 dark:text-amber-200 mb-3">
                    You must sign the agreement before submitting videos.
                  </p>
                  <Button onClick={() => setShowSignatureModal(true)} size="sm">
                    Sign Agreement
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Videos List */}
        {videos.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold px-2">Submitted Videos</h2>
            {videos.map(video => (
              <Card key={video.id} className={video.status === 'rejected' ? 'opacity-50 border-red-200' : ''}>
                <CardContent className="pt-4">
                  {video.status === 'rejected' && (
                    <div className="flex items-center gap-1.5 mb-3 px-2 py-1.5 rounded-md bg-red-50 text-red-600 text-xs font-medium">
                      <X className="w-3 h-3" />
                      Rejected - Please submit a new video to replace this one
                    </div>
                  )}
                  <div className="space-y-3">
                    <div className="aspect-video bg-muted rounded-lg overflow-hidden flex items-center justify-center">
                      {video.thumbnail_url ? (
                        <img
                          src={video.thumbnail_url}
                          alt={video.title || 'Video'}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Video className="w-8 h-8 text-muted-foreground" />
                      )}
                    </div>

                    {video.title && (
                      <p className="text-sm font-medium">{video.title}</p>
                    )}

                    <div className="grid grid-cols-4 gap-3 py-3">
                      <div className="text-center space-y-1">
                        <Eye className="w-4 h-4 text-muted-foreground mx-auto" />
                        <p className="text-xs font-semibold">{formatNumber(video.view_count || 0)}</p>
                        <p className="text-xs text-muted-foreground">Views</p>
                      </div>
                      <div className="text-center space-y-1">
                        <Heart className="w-4 h-4 text-muted-foreground mx-auto" />
                        <p className="text-xs font-semibold">{formatNumber(video.like_count || 0)}</p>
                        <p className="text-xs text-muted-foreground">Likes</p>
                      </div>
                      <div className="text-center space-y-1">
                        <MessageCircle className="w-4 h-4 text-muted-foreground mx-auto" />
                        <p className="text-xs font-semibold">{formatNumber(video.comment_count || 0)}</p>
                        <p className="text-xs text-muted-foreground">Comments</p>
                      </div>
                      <div className="text-center space-y-1">
                        <Share2 className="w-4 h-4 text-muted-foreground mx-auto" />
                        <p className="text-xs font-semibold">{formatNumber(video.share_count || 0)}</p>
                        <p className="text-xs text-muted-foreground">Shares</p>
                      </div>
                    </div>

                    <Separator />

                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="font-mono text-xs">
                        {video.spark_ad_code}
                      </Badge>
                      <a
                        href={video.tiktok_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                      >
                        View on TikTok
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      {new Date(video.created_at).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
