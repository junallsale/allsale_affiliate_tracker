export interface Brand {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;
  project_count?: number;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  brand_id: string;
  name: string;
  description?: string;
  slug: string;
  status: "active" | "paused" | "completed" | "archived";
  start_date?: string;
  end_date?: string;
  submission_deadline?: string;
  budget?: number;
  created_at: string;
  updated_at: string;
  // Computed
  brand?: Brand;
  total_assigned_videos?: number;
  total_uploaded_videos?: number;
  total_creators?: number;
  completed_creators?: number;
}

export interface Creator {
  id: string;
  name: string;
  email: string;
  tiktok_handle: string;
  slug: string;
  bio?: string;
  profile_image_url?: string;
  created_at: string;
  updated_at: string;
}

export type ContentType = "shoppable_video" | "live_shopping";

export interface ProjectCreator {
  id: string;
  project_id: string;
  creator_id: string;
  unique_slug: string;
  assigned_video_count: number;
  content_type: ContentType;
  contract_amount: number;
  advance_payment: number;
  remaining_payment: number;
  commission_rate: number;
  contact_point?: string;
  communication_link?: string;
  sample_shipped: boolean;
  contract_sent: boolean;
  contract_sent_at?: string;
  payment_email?: string;
  status: "pending" | "in-progress" | "completed";
  created_at: string;
  updated_at: string;
  creator?: Creator;
  project?: Project & { brand?: Brand };
  upload_deadline?: string | null;
  legal_name?: string | null;
  signature_url?: string | null;
  signed_at?: string | null;
  videos?: Video[];
  products?: Product[];
  payments?: Payment[];
}

export interface Payment {
  id: string;
  project_creator_id: string;
  amount: number;
  payment_date: string;
  note?: string;
  invoice_url?: string;
  /** True when this row is a refund (amount is negative). */
  is_refund?: boolean;
  /** The original payment this refund reverses, if any. */
  refund_of?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Video {
  id: string;
  project_creator_id: string;
  tiktok_url: string;
  spark_ad_code: string;
  tiktok_video_id?: string;
  title?: string;
  thumbnail_url?: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
  status: "draft" | "submitted" | "approved" | "rejected";
  metadata_updated_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  brand_id: string;
  name: string;
  thumbnail_url?: string;
  content_guide_url?: string;
  product_link?: string;
  sample_invitation_url?: string;
  sample_invitation_label?: string;
  is_bundle: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductBundleComponent {
  id: string;
  bundle_product_id: string;
  component_product_id: string;
  position: number;
  created_at: string;
  component?: Product;
}

export interface ProjectCreatorRemind {
  id: string;
  project_creator_id: string;
  remind_date: string;
  note?: string | null;
  created_at: string;
}

export interface ProjectCreatorProduct {
  id: string;
  project_creator_id: string;
  product_id: string;
  product?: Product;
}

export interface ProjectCreatorMemo {
  id: string;
  project_creator_id: string;
  content: string;
  author_name?: string;
  created_at: string;
  updated_at: string;
}

// Affiliate Database Types

export interface AffiliateCreator {
  id: string;
  handle: string;
  gmv: number | null;
  live_commission: number | null;
  live_price: number | null;
  avg_view: number | null;
  engagement: number | null;
  followers: number | null;
  max_price: number | null;
  min_price: number | null;
  price_comment: string | null;
  project: string | null;
  brand_id: string | null;
  project_id: string | null;
  thread: string | null;
  tier: number | string | null;
  category: string | null;
  contact_type: string | null;
  status: string | null;
  gender: string | null;
  email: string | null;
  payment_method: string | null;
  confirmation_status: string | null;
  contract_sent: string | null;
  payment_status: string | null;
  advance_payment_date: string | null;
  final_payment_date: string | null;
  uploaded_video_count: number;
  planned_video_count: number;
  price_per_video: number | null;
  contract_amount: number | null;
  recommendation_reason: string | null;
  campaign_source: number | null;
  custom_data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ViewFilter {
  column: string;
  operator: 'eq' | 'neq' | 'contains' | 'not_contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'is_empty' | 'is_not_empty';
  value?: string | number;
}

export interface AffiliateView {
  id: string;
  name: string;
  slug: string;
  filters: ViewFilter[];
  visible_columns: string[];
  column_order: string[];
  sort_config: { column: string; direction: 'asc' | 'desc' };
  created_at: string;
  updated_at: string;
}

export interface AffiliateCustomColumn {
  id: string;
  name: string;
  key: string;
  column_type: 'select' | 'multi_select' | 'text' | 'number' | 'link' | 'email';
  options: { value: string; color?: string }[];
  sort_order: number;
  created_at: string;
}

export interface AffiliateComment {
  id: string;
  affiliate_creator_id: string;
  author_name: string;
  content: string;
  created_at: string;
}

export type FinanceInvoiceStatus = 'finalized' | 'superseded' | 'void';

export interface FinanceInvoice {
  id: string;
  brand_id: string;
  period_year: number;
  period_month: number;
  status: FinanceInvoiceStatus;
  finalized_at: string;
  finalized_by: string | null;
  snapshot_total_amount: number;
  snapshot_creator_count: number;
  notes: string | null;
  superseded_by: string | null;
  created_at: string;
}

export type FinanceRefundStatus = 'none' | 'pending' | 'refunded' | 'waived';

export interface FinanceInvoiceLine {
  id: string;
  invoice_id: string;
  project_creator_id: string;
  project_id: string;
  creator_id: string;
  contract_amount: number;
  assigned_video_count: number | null;
  signed_at: string | null;
  snapshot: {
    creator_name?: string;
    tiktok_handle?: string;
    project_name?: string;
    finalized_at?: string;
  };
  refund_status: FinanceRefundStatus;
  refund_amount: number | null;
  refund_note: string | null;
  refund_updated_at: string | null;
  refund_updated_by: string | null;
}

/** Money actually received from a brand for a period (manual monthly entry). */
export interface BrandSettlement {
  id: string;
  brand_id: string;
  period_year: number;
  period_month: number;
  amount: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type AssignResultStatus = 'assigned' | 'already_assigned' | 'deleted_in_project' | 'reactivated';

export interface AssignResultRow {
  handle: string;
  affiliate_creator_id: string;
  status?: AssignResultStatus;
  error?: string;
}

export interface AssignResult {
  results: AssignResultRow[];
}
