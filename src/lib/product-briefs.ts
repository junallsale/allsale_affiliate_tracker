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

export interface BundleComponent {
  id: string;
  name: string;
  content_guide_url: string | null;
  position: number;
}

/** bundle product id → 그 번들의 구성품 목록. */
export type ComponentsByBundle = Map<string, BundleComponent[]>;

/**
 * 번들 구성품을 한 번에 읽는다.
 *
 * 여러 project_creator 를 한 루프에서 처리할 때(cron) 번들 id 를 전부 모아
 * 이 함수를 **한 번만** 부르면 건당 왕복이 사라진다.
 */
export async function fetchBundleComponents(
  bundleIds: string[],
  client?: SupabaseClient,
): Promise<ComponentsByBundle> {
  const componentsByBundle: ComponentsByBundle = new Map();
  const ids = [...new Set(bundleIds.filter(Boolean))];
  if (!ids.length) return componentsByBundle;

  const supabase = client || getServiceClient();
  // Explicit FK hint required — products has two FKs to product_bundle_components
  // (bundle_product_id + component_product_id), so PostgREST cannot auto-resolve.
  const { data: rows } = await supabase
    .from('product_bundle_components')
    .select('bundle_product_id, position, component:products!product_bundle_components_component_product_id_fkey(id, name, content_guide_url)')
    .in('bundle_product_id', ids)
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

  return componentsByBundle;
}

/**
 * 이미 읽어둔 데이터만으로 brief 목록을 만든다(DB 조회 없음).
 * 번들은 구성품을 펼쳐 넣고, product id 로 중복을 제거한다.
 */
export function expandProductBriefItems(
  assignedProducts: AssignedProductRef[] | null | undefined,
  componentsByBundle: ComponentsByBundle,
): BriefItem[] {
  const products = (assignedProducts || [])
    .map((p) => p?.product)
    .filter((p): p is NonNullable<AssignedProductRef['product']> => !!p && !!p.id);

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

/**
 * Expand assigned products (already loaded from the join) into a flat brief list.
 * 번들이 있을 때만 구성품을 한 번 더 읽는다. 단건 호출용 래퍼.
 */
export async function buildProductBriefItems(
  assignedProducts: AssignedProductRef[] | null | undefined,
  client?: SupabaseClient,
): Promise<BriefItem[]> {
  const bundleIds = (assignedProducts || [])
    .map((p) => p?.product)
    .filter((p) => p?.id && p.is_bundle)
    .map((p) => p!.id);

  const componentsByBundle = await fetchBundleComponents(bundleIds, client);
  return expandProductBriefItems(assignedProducts, componentsByBundle);
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
