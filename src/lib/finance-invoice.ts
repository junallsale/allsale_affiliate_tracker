/**
 * Finance invoice computation (shared by the landing dashboard and the brand
 * detail page).
 *
 * Two invoice bases coexist (June 2026 cutover):
 *   - signed  (contract signed_at < 2026-06-01): the full contract_amount is
 *     invoiced in the month the contract was signed. This is the legacy logic.
 *   - video   (contract signed_at >= 2026-06-01): the contract is pro-rated per
 *     approved video, attributed to the video's posting month. Per-video rate =
 *     contract_amount / assigned_video_count. A month's invoice = (approved
 *     videos posted that month) x per-video rate.
 *
 * "Posting month" uses videos.created_at (submission ~= posting, accepted as a
 * proxy; there is no real TikTok posting timestamp in the DB).
 * "Approved" = videos.status in ('submitted','approved') (not draft/rejected).
 *
 * Rounding: the per-month value is a difference of two rounded cumulatives, so
 * cent drift self-corrects — when all assigned videos are posted the cumulative
 * equals round2(contract_amount) exactly. Under-posting leaves the remainder
 * permanently un-invoiced (intended).
 *
 * All functions are pure (no Supabase import) so they are trivially testable.
 */

/** Contracts signed on/after this date use the per-video pro-rata basis. */
export const CUTOVER_ISO = '2026-06-01';

export type InvoiceBasis = 'signed' | 'video';

/** Video statuses that count toward invoicing. */
export const COUNTABLE_VIDEO_STATUSES = ['submitted', 'approved'] as const;

export interface MonthBucket {
  /** Full year, e.g. 2026. */
  year: number;
  /** 1-12. */
  month: number;
}

export interface ContractInput {
  projectCreatorId: string;
  contractAmount: number;
  assignedVideoCount: number;
  signedAt: string | null;
  /** Month keys ('YYYY-MM') of each countable video, one entry per video. */
  postedMonths: string[];
  // passthrough for UI grouping
  projectId: string;
  projectName: string;
  creatorName: string;
  tiktokHandle: string;
}

export interface PaymentInput {
  amount: number;
  payment_date: string;
}

// ── primitives ───────────────────────────────────────────────────────────────

/** 'YYYY-MM' month key from an ISO timestamp (date part only). Null-safe. */
export function monthKeyOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  // ISO strings start with 'YYYY-MM-DD...'; take the first 7 chars.
  const key = iso.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(key) ? key : null;
}

/** Month key for a {year, month} bucket. */
export function monthKeyOfBucket(m: MonthBucket): string {
  return `${m.year}-${String(m.month).padStart(2, '0')}`;
}

/** The month key immediately before the given bucket. */
export function prevMonthKey(m: MonthBucket): string {
  const month = m.month === 1 ? 12 : m.month - 1;
  const year = m.month === 1 ? m.year - 1 : m.year;
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Round to 2 decimals, avoiding negative-zero and float fuzz. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Which invoice logic applies to a contract, by its signed_at. */
export function basisOf(signedAt: string | null): InvoiceBasis {
  if (!signedAt) return 'signed';
  return signedAt >= CUTOVER_ISO ? 'video' : 'signed';
}

// ── mapping ──────────────────────────────────────────────────────────────────

interface PcVideoRow {
  id: string;
  contract_amount: number | null;
  assigned_video_count: number | null;
  signed_at: string | null;
  project_id?: string;
  projects?: { id?: string; name?: string } | null;
  creator?: { name?: string; tiktok_handle?: string } | null;
  videos?: { status?: string; created_at?: string | null }[] | null;
}

/** Build a ContractInput from a nested project_creators + videos row. */
export function toContractInput(row: PcVideoRow): ContractInput {
  const postedMonths: string[] = [];
  for (const v of row.videos ?? []) {
    if (!v?.status) continue;
    if (!(COUNTABLE_VIDEO_STATUSES as readonly string[]).includes(v.status)) continue;
    const key = monthKeyOf(v.created_at);
    if (key) postedMonths.push(key);
  }
  return {
    projectCreatorId: row.id,
    contractAmount: Number(row.contract_amount) || 0,
    assignedVideoCount: Number(row.assigned_video_count) || 0,
    signedAt: row.signed_at ?? null,
    postedMonths,
    projectId: row.projects?.id || row.project_id || 'unknown',
    projectName: row.projects?.name || 'Unknown',
    creatorName: row.creator?.name || '',
    tiktokHandle: row.creator?.tiktok_handle || '',
  };
}

// ── core math ────────────────────────────────────────────────────────────────

/** Count of countable videos posted in months <= throughKey. */
function cumulativePostedCount(c: ContractInput, throughKey: string): number {
  let n = 0;
  for (const k of c.postedMonths) if (k <= throughKey) n++;
  return n;
}

/**
 * Total amount invoiced for this contract through the end of `throughKey`
 * ('YYYY-MM'). Cumulative so per-month differences self-correct rounding.
 */
export function cumulativeInvoiced(c: ContractInput, throughKey: string): number {
  const basis = basisOf(c.signedAt);
  if (basis === 'signed') {
    if (c.contractAmount <= 0) return 0;
    const signedKey = monthKeyOf(c.signedAt);
    if (!signedKey) return 0;
    return signedKey <= throughKey ? round2(c.contractAmount) : 0;
  }
  // video basis
  if (c.assignedVideoCount <= 0 || c.contractAmount <= 0) return 0;
  const capped = Math.min(cumulativePostedCount(c, throughKey), c.assignedVideoCount);
  return round2((c.contractAmount * capped) / c.assignedVideoCount);
}

/** This contract's invoice amount for a single month. */
export function monthInvoiceForContract(c: ContractInput, m: MonthBucket): number {
  const cur = cumulativeInvoiced(c, monthKeyOfBucket(m));
  const prev = cumulativeInvoiced(c, prevMonthKey(m));
  return round2(cur - prev);
}

/** This contract's all-time invoiced amount (cumulative through the latest data). */
export function allTimeInvoicedForContract(c: ContractInput): number {
  // '9999-12' is an upper bound greater than any real month key.
  return cumulativeInvoiced(c, '9999-12');
}

/** Per-video rate (0 when not applicable). */
export function perVideoRate(c: ContractInput): number {
  if (c.assignedVideoCount <= 0 || c.contractAmount <= 0) return 0;
  return round2(c.contractAmount / c.assignedVideoCount);
}

// ── brand-level aggregates ───────────────────────────────────────────────────

export function brandMonthInvoice(contracts: ContractInput[], m: MonthBucket): number {
  return round2(contracts.reduce((s, c) => s + monthInvoiceForContract(c, m), 0));
}

export function brandAllTimeInvoice(contracts: ContractInput[]): number {
  return round2(contracts.reduce((s, c) => s + allTimeInvoicedForContract(c), 0));
}

// ── per-creator breakdown (brand detail monthly view) ────────────────────────

export interface CreatorInvoiceLine {
  projectCreatorId: string;
  projectId: string;
  projectName: string;
  creatorName: string;
  tiktokHandle: string;
  basis: InvoiceBasis;
  contractAmount: number;
  assignedVideoCount: number;
  postedThisMonth: number;
  cumulativePostedThroughMonth: number;
  perVideoRate: number;
  monthInvoice: number;
}

export function creatorLinesForMonth(contracts: ContractInput[], m: MonthBucket): CreatorInvoiceLine[] {
  const curKey = monthKeyOfBucket(m);
  return contracts.map((c) => {
    const postedThisMonth = c.postedMonths.filter((k) => k === curKey).length;
    const cumulative = cumulativePostedCount(c, curKey);
    return {
      projectCreatorId: c.projectCreatorId,
      projectId: c.projectId,
      projectName: c.projectName,
      creatorName: c.creatorName,
      tiktokHandle: c.tiktokHandle,
      basis: basisOf(c.signedAt),
      contractAmount: c.contractAmount,
      assignedVideoCount: c.assignedVideoCount,
      postedThisMonth,
      cumulativePostedThroughMonth: cumulative,
      perVideoRate: perVideoRate(c),
      monthInvoice: monthInvoiceForContract(c, m),
    };
  });
}

// ── payments ─────────────────────────────────────────────────────────────────

export function paidInMonth(payments: PaymentInput[], m: MonthBucket): number {
  const key = monthKeyOfBucket(m);
  return round2(
    payments.reduce((s, p) => (monthKeyOf(p.payment_date) === key ? s + (Number(p.amount) || 0) : s), 0),
  );
}

export function paidAllTime(payments: { amount: number }[]): number {
  return round2(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0));
}
