import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { estimatePrice } from '@/lib/pricing';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function handleEstimate(avgView: number, gmv: number) {
  // Static tier-based calculation (instant)
  const estimate = estimatePrice(avgView, gmv);

  // DB query only for comparable creators
  const viewRange = [avgView * 0.5, avgView * 1.5];
  const { data: comparables } = await supabase
    .from('affiliate_creators')
    .select('handle, gmv, avg_view, price_per_video')
    .gte('avg_view', viewRange[0])
    .lte('avg_view', viewRange[1])
    .not('price_per_video', 'is', null)
    .gt('price_per_video', 0)
    .order('gmv', { ascending: false })
    .limit(10);

  return {
    input: { avg_view: avgView, gmv },
    ...estimate,
    sample_size: (comparables || []).length,
    price_range: {
      low: Math.round(estimate.estimated_price * 0.75 / 25) * 25,
      mid: estimate.estimated_price,
      high: Math.round(estimate.estimated_price * 1.35 / 25) * 25,
    },
    comparable_creators: comparables || [],
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const avgView = parseFloat(searchParams.get('avg_view') || '0');
  const gmv = parseFloat(searchParams.get('gmv') || '0');

  if (!avgView) {
    return NextResponse.json({ error: 'avg_view is required' }, { status: 400 });
  }

  return NextResponse.json(await handleEstimate(avgView, gmv));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { avg_view, gmv } = body;

  if (!avg_view) {
    return NextResponse.json({ error: 'avg_view is required' }, { status: 400 });
  }

  return NextResponse.json(await handleEstimate(avg_view, gmv || 0));
}
