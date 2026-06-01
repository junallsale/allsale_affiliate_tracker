/**
 * Demo brand/data isolation.
 *
 * The demo brand (for the external demo viewer account) is fully visible inside
 * its own brand and project pages, but must NOT appear in any operational
 * aggregate page: Brands list, Affiliates, Creators, Checklist, Payments,
 * Finance, Email Queue, Pricing comparables, etc.
 *
 * We filter by a fixed brand id rather than a DB flag so no schema change is
 * needed and production DB is never touched.
 */
export const DEMO_BRAND_IDS: string[] = [
  'de100000-0000-4000-8000-000000000001', // Aurelia Skin (Demo)
];

const DEMO_BRAND_ID_SET = new Set(DEMO_BRAND_IDS);

/** True if the given brand id belongs to demo data. */
export function isDemoBrandId(brandId: string | null | undefined): boolean {
  return !!brandId && DEMO_BRAND_ID_SET.has(brandId);
}

/**
 * Remove rows belonging to a demo brand. `getBrandId` extracts the brand id
 * from a row (handles nested shapes like row.projects.brand_id).
 */
export function excludeDemo<T>(rows: T[], getBrandId: (row: T) => string | null | undefined): T[] {
  return rows.filter((row) => !isDemoBrandId(getBrandId(row)));
}
