/**
 * Product brief item builder + HTML renderers.
 *
 * Used by email composers (email-service.ts, draft-composer.ts) to expand a
 * creator's assigned products into a flat list of briefs. When an assigned
 * product is a bundle, its component products are inlined as separate items.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type BriefRole = 'standalone' | 'bundle' | 'component';

export interface BriefItem {
  productId: string;
  label: string;
  contentGuideUrl: string | null;
  role: BriefRole;
  bundleProductId?: string;
}

/** A lightly-typed shape for the `project_creator_products` join we always fetch. */
export interface AssignedProductRef {
  product?: {
    id: string;
    name: string;
    content_guide_url?: string | null;
    is_bundle?: boolean | null;
  } | null;
}

function getServiceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/**
 * Expand assigned products (already loaded from the join) into a flat brief list.
 * Bundles are inlined with their component products (same brand, fetched in one
 * additional query). Deduplicates by product id so the same product never
 * appears twice.
 */
export async function buildProductBriefItems(
  assignedProducts: AssignedProductRef[] | null | undefined,
  client?: SupabaseClient,
): Promise<BriefItem[]> {
  const products = (assignedProducts || [])
    .map((p) => p?.product)
    .filter((p): p is NonNullable<AssignedProductRef['product']> => !!p && !!p.id);

  if (!products.length) return [];

  const bundleIds = products.filter((p) => p.is_bundle).map((p) => p.id);

  const componentsByBundle = new Map<
    string,
    Array<{ id: string; name: string; content_guide_url: string | null; position: number }>
  >();

  if (bundleIds.length) {
    const supabase = client || getServiceClient();
    // Explicit FK hint required — products has two FKs to product_bundle_components
    // (bundle_product_id + component_product_id), so PostgREST cannot auto-resolve.
    const { data: rows } = await supabase
      .from('product_bundle_components')
      .select('bundle_product_id, position, component:products!product_bundle_components_component_product_id_fkey(id, name, content_guide_url)')
      .in('bundle_product_id', bundleIds)
      .order('position', { ascending: true });

    for (const row of rows || []) {
      const bundleId = (row as any).bundle_product_id as string;
      const comp = (row as any).component;
      if (!bundleId || !comp?.id) continue;
      if (!componentsByBundle.has(bundleId)) componentsByBundle.set(bundleId, []);
      componentsByBundle.get(bundleId)!.push({
        id: comp.id,
        name: comp.name,
        content_guide_url: comp.content_guide_url || null,
        position: (row as any).position ?? 0,
      });
    }
  }

  const items: BriefItem[] = [];
  const seen = new Set<string>();

  for (const p of products) {
    if (seen.has(p.id)) continue;

    if (p.is_bundle) {
      items.push({
        productId: p.id,
        label: p.name,
        contentGuideUrl: p.content_guide_url || null,
        role: 'bundle',
      });
      seen.add(p.id);
      for (const c of componentsByBundle.get(p.id) || []) {
        if (seen.has(c.id)) continue;
        items.push({
          productId: c.id,
          label: c.name,
          contentGuideUrl: c.content_guide_url,
          role: 'component',
          bundleProductId: p.id,
        });
        seen.add(c.id);
      }
    } else {
      items.push({
        productId: p.id,
        label: p.name,
        contentGuideUrl: p.content_guide_url || null,
        role: 'standalone',
      });
      seen.add(p.id);
    }
  }

  return items;
}

/** True if items include any bundle or more than one product. */
export function hasMultipleBriefs(items: BriefItem[]): boolean {
  if (items.length > 1) return true;
  return items.some((i) => i.role === 'bundle' || i.role === 'component');
}

/**
 * Render an `<li>` block for use inside a campaign details `<ul>`.
 * Backward-compat: a single standalone item with a URL renders the legacy
 * "Product brief: <link>" one-liner. Otherwise produces a nested list.
 * Returns empty string when there is nothing link-worthy to show.
 */
export function renderContentGuideSectionLi(items: BriefItem[]): string {
  const renderable = items.filter((i) => !!i.contentGuideUrl || i.role === 'bundle' || i.role === 'component');
  if (!renderable.length) return '';

  if (renderable.length === 1 && renderable[0].role === 'standalone' && renderable[0].contentGuideUrl) {
    return `<li><strong>Product brief:</strong> <a href="${renderable[0].contentGuideUrl}">Content Guide</a></li>`;
  }

  const lis = renderable
    .map((it) => {
      const label = it.role === 'bundle' ? `${it.label} (bundle)` : it.label;
      return it.contentGuideUrl
        ? `<li><a href="${it.contentGuideUrl}">${label}</a></li>`
        : `<li>${label}</li>`;
    })
    .join('');

  return `<li><strong>Product briefs:</strong><ul>${lis}</ul></li>`;
}

/**
 * Render a standalone `<p>` paragraph for the content_brief reply context.
 * Single item → inline link. Multiple → intro paragraph + nested list.
 * Returns empty string when no URLs are available.
 */
export function renderContentGuideParagraph(items: BriefItem[], brandName: string): string {
  const renderable = items.filter((i) => !!i.contentGuideUrl || i.role === 'bundle' || i.role === 'component');
  if (!renderable.length) return '';

  if (renderable.length === 1 && renderable[0].role === 'standalone' && renderable[0].contentGuideUrl) {
    return `<p>Here's the content guide for your <strong>${brandName}</strong> campaign: <a href="${renderable[0].contentGuideUrl}">Content Guide</a></p>`;
  }

  const lis = renderable
    .map((it) => {
      const label = it.role === 'bundle' ? `${it.label} (bundle)` : it.label;
      return it.contentGuideUrl
        ? `<li><a href="${it.contentGuideUrl}">${label}</a></li>`
        : `<li>${label}</li>`;
    })
    .join('');

  return `<p>Here are the content guides for your <strong>${brandName}</strong> campaign:</p><ul>${lis}</ul>`;
}
