// Shared pricing logic — used by both /api/pricing/estimate and /api/affiliates (tier calculation)

// View-based pricing tiers derived from 323 creators with confirmed pricing
// Updated 2026-03-26 with latest median price_per_video data
export const VIEW_TIERS = [
  { maxView: 500,    basePrice: 150,  label: 'Nano' },
  { maxView: 1000,   basePrice: 250,  label: 'Micro-Low' },
  { maxView: 2000,   basePrice: 300,  label: 'Micro' },
  { maxView: 3000,   basePrice: 700,  label: 'Mid-Low' },
  { maxView: 5000,   basePrice: 600,  label: 'Mid' },
  { maxView: 10000,  basePrice: 1000, label: 'Mid-High' },
  { maxView: 50000,  basePrice: 3500, label: 'Macro' },
  { maxView: Infinity, basePrice: 5500, label: 'Top' },
];

export function gmvMultiplier(gmv: number): number {
  if (gmv >= 300000) return 1.25;
  if (gmv >= 200000) return 1.15;
  if (gmv >= 100000) return 1.10;
  if (gmv >= 50000)  return 1.05;
  return 1.0;
}

export function estimatePrice(avgView: number, gmv: number) {
  const tier = VIEW_TIERS.find(t => avgView < t.maxView) || VIEW_TIERS[VIEW_TIERS.length - 1];
  const tierIndex = VIEW_TIERS.indexOf(tier);
  const prevTier = tierIndex > 0 ? VIEW_TIERS[tierIndex - 1] : { maxView: 0, basePrice: 50 };

  const lowerBound = prevTier.maxView;
  const upperBound = tier.maxView === Infinity ? prevTier.maxView * 3 : tier.maxView;
  const ratio = Math.min((avgView - lowerBound) / (upperBound - lowerBound), 1);

  const interpolatedPrice = prevTier.basePrice + (tier.basePrice - prevTier.basePrice) * ratio;

  const multiplier = gmvMultiplier(gmv);
  const adjustedPrice = interpolatedPrice * multiplier;
  const roundedPrice = Math.round(adjustedPrice / 25) * 25;

  return {
    estimated_price: roundedPrice,
    tier: tier.label,
    gmv_multiplier: multiplier,
    base_price: Math.round(interpolatedPrice),
    confidence: tierIndex <= 4 ? 'high' : 'medium',
  };
}

/**
 * Calculate tier based on price_per_video vs estimated price range.
 *   - tier 3: price > High (estimated * 1.35) — expensive
 *   - tier 2: Low <= price <= High — fair price
 *   - tier 1: price < Low (estimated * 0.75) — good deal
 *
 * Returns null if avg_view is missing (can't estimate).
 */
export function calculateTier(pricePerVideo: number, avgView: number, gmv: number): number | null {
  if (!avgView || !pricePerVideo) return null;

  const estimate = estimatePrice(avgView, gmv || 0);
  const low = Math.round(estimate.estimated_price * 0.75 / 25) * 25;
  const high = Math.round(estimate.estimated_price * 1.35 / 25) * 25;

  if (pricePerVideo > high) return 3;
  if (pricePerVideo >= low) return 2;
  return 1;
}
