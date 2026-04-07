export interface ColumnDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'link' | 'email' | 'select' | 'multi_select' | 'date' | 'computed';
  editable: boolean;
  options?: { value: string; color?: string }[];
  width?: number;
}

export const FIXED_COLUMNS: ColumnDef[] = [
  { key: 'handle', label: 'Handle', type: 'text', editable: true, width: 160 },
  { key: 'brand_id', label: 'Brand', type: 'select', editable: true, width: 130, options: [] },
  { key: 'project_id', label: 'Project', type: 'select', editable: true, width: 160, options: [] },
  { key: 'status', label: 'Status', type: 'select', editable: true, width: 150, options: [
    { value: 'Pre-confirm', color: '#94a3b8' },
    { value: 'Email Sent', color: '#3b82f6' },
    { value: 'In Discussion', color: '#3b82f6' },
    { value: 'Rate Received', color: '#f59e0b' },
    { value: 'Confirm Req', color: '#f59e0b' },
    { value: 'Confirmed', color: '#8b5cf6' },
    { value: 'Contracting', color: '#8b5cf6' },
    { value: 'Sample Sent', color: '#8b5cf6' },
    { value: 'Uploading', color: '#22c55e' },
    { value: 'Uploaded', color: '#22c55e' },
    { value: 'Done', color: '#22c55e' },
    { value: 'Brand Rejected', color: '#ef4444' },
    { value: 'Rejected', color: '#ef4444' },
  ]},
  { key: 'contact_type', label: 'Contact Type', type: 'select', editable: true, width: 140, options: [
    { value: 'allsale-affiliate-work', color: '#8b5cf6' },
    { value: 'email', color: '#3b82f6' },
    { value: 'dm', color: '#f59e0b' },
    { value: 'other', color: '#94a3b8' },
  ]},
  { key: 'confirmation_status', label: 'Confirmation', type: 'select', editable: true, width: 110, options: [
    { value: 'Yes', color: '#22c55e' },
    { value: 'No', color: '#ef4444' },
    { value: 'Hold', color: '#f59e0b' },
  ]},
  { key: 'gender', label: 'Gender', type: 'select', editable: true, width: 80, options: [
    { value: 'male', color: '#3b82f6' },
    { value: 'female', color: '#ec4899' },
    { value: 'other', color: '#94a3b8' },
  ]},
  { key: 'payment_method', label: 'Payment Method', type: 'select', editable: true, width: 110, options: [
    { value: 'PayPal', color: '#3b82f6' },
    { value: 'Wise', color: '#22c55e' },
    { value: 'Zelle', color: '#8b5cf6' },
    { value: 'other', color: '#94a3b8' },
  ]},
  { key: 'payment_status', label: 'Payment Status', type: 'select', editable: true, width: 140, options: [
    { value: 'Brand Rejected', color: '#ef4444' },
    { value: 'Rate Received', color: '#f59e0b' },
    { value: 'Brand Confirmed', color: '#22c55e' },
    { value: 'Email Sent', color: '#3b82f6' },
    { value: 'In Discussion', color: '#8b5cf6' },
    { value: 'Sample Sent', color: '#06b6d4' },
  ]},
  { key: 'followers', label: 'Followers', type: 'number', editable: true, width: 110 },
  { key: 'avg_view', label: 'Avg.View', type: 'number', editable: true, width: 110 },
  { key: 'engagement', label: 'Engagement(%)', type: 'number', editable: true, width: 120 },
  { key: 'gmv', label: 'GMV', type: 'number', editable: true, width: 100 },
  { key: 'live_commission', label: 'LIVE Commission', type: 'number', editable: true, width: 130 },
  { key: 'live_price', label: 'LIVE Price', type: 'number', editable: true, width: 110 },
  { key: 'max_price', label: 'Max Price', type: 'number', editable: true, width: 100 },
  { key: 'min_price', label: 'Min Price', type: 'number', editable: true, width: 100 },
  { key: 'price_comment', label: 'Price Comment', type: 'text', editable: true, width: 180 },
  { key: 'tier', label: 'Tier', type: 'number', editable: true, width: 70 },
  { key: 'category', label: 'Category', type: 'text', editable: true, width: 120 },
  { key: 'email', label: 'Email', type: 'email', editable: true, width: 200 },
  { key: 'thread', label: 'Thread', type: 'link', editable: true, width: 100 },
  { key: 'planned_video_count', label: 'Planned Videos', type: 'number', editable: true, width: 130 },
  { key: 'price_per_video', label: 'Price Per Video', type: 'number', editable: true, width: 140 },
  { key: 'contract_amount', label: 'Contract Amount', type: 'number', editable: true, width: 110 },
  { key: 'uploaded_video_count', label: 'Uploaded Videos', type: 'number', editable: true, width: 130 },
  { key: 'contract_sent', label: 'Contract Sent', type: 'text', editable: true, width: 120 },
  { key: 'advance_payment_date', label: 'Advance Payment', type: 'date', editable: true, width: 120 },
  { key: 'final_payment_date', label: 'Final Payment', type: 'date', editable: true, width: 120 },
  { key: 'recommendation_reason', label: 'Recommendation', type: 'text', editable: true, width: 200 },
];

export const DEFAULT_VISIBLE_COLUMNS = [
  'handle', 'brand_id', 'project_id', 'status', 'contact_type', 'confirmation_status',
  'followers', 'avg_view', 'gmv', 'engagement', 'max_price', 'min_price', 'price_comment',
  'planned_video_count', 'contract_amount',
];

export const COLUMN_MAP_KO_EN: Record<string, string> = {
  'handle': 'handle',
  'GMV': 'gmv',
  'LIVE commission': 'live_commission',
  'LIVE price': 'live_price',
  'avg.view': 'avg_view',
  'engagement(%)': 'engagement',
  'followers': 'followers',
  'max price': 'max_price',
  'min price': 'min_price',
  'price comment': 'price_comment',
  'project': 'project',
  'thread': 'thread',
  'tier': 'tier',
  'category': 'category',
  'contact type': 'contact_type',
  '상태': 'status',
  '성별': 'gender',
  '이메일': 'email',
  '지급방식': 'payment_method',
  '컨펌여부': 'confirmation_status',
  '계약서발송': 'contract_sent',
  '입금상태': 'payment_status',
  '선금지급일': 'advance_payment_date',
  '잔금지급일': 'final_payment_date',
  '업로드비디오수': 'uploaded_video_count',
  '예정비디오개수': 'planned_video_count',
  '예정비디오당가격': 'price_per_video',
  '추천사유': 'recommendation_reason',
};

export const NUMERIC_COLUMNS = new Set([
  'gmv', 'live_commission', 'live_price', 'avg_view', 'engagement',
  'followers', 'max_price', 'min_price', 'tier',
  'uploaded_video_count', 'planned_video_count', 'price_per_video', 'contract_amount',
]);
