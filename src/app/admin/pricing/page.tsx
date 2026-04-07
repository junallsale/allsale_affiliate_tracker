'use client';

import { useState } from 'react';
import { Calculator, TrendingUp, Users, ArrowRight, Loader2, BarChart3, ExternalLink } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface PriceEstimate {
  input: { avg_view: number; gmv: number };
  estimated_price: number;
  tier: string;
  gmv_multiplier: number;
  base_price: number;
  confidence: string;
  sample_size: number;
  price_range: { low: number; mid: number; high: number };
  comparable_creators: {
    handle: string;
    gmv: string | null;
    avg_view: string | null;
    price_per_video: string | null;
    min_price: string | null;
    contract_amount: string | null;
  }[];
}

export default function PricingPage() {
  const [avgView, setAvgView] = useState('');
  const [gmv, setGmv] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PriceEstimate | null>(null);

  const handleEstimate = async () => {
    if (!avgView) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/pricing/estimate?avg_view=${avgView}&gmv=${gmv || 0}`);
      const data = await res.json();
      setResult(data);
    } catch (error) {
      console.error('Estimation failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

  const formatNumber = (n: number) => new Intl.NumberFormat('en-US').format(n);

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="max-w-4xl mx-auto p-6">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Calculator className="w-6 h-6" />
            Creator Price Estimator
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Estimate fair pricing based on real creator data
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Input Section */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Input Creator Stats</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
              <div className="space-y-2">
                <Label htmlFor="avg-view" className="flex items-center gap-1">
                  <BarChart3 className="w-3.5 h-3.5" />
                  Avg. Views <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="avg-view"
                  type="number"
                  min={0}
                  placeholder="e.g. 2500"
                  value={avgView}
                  onChange={(e) => setAvgView(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleEstimate()}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gmv" className="flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5" />
                  GMV ($)
                </Label>
                <Input
                  id="gmv"
                  type="number"
                  min={0}
                  placeholder="e.g. 150000 (optional)"
                  value={gmv}
                  onChange={(e) => setGmv(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleEstimate()}
                />
              </div>
              <Button onClick={handleEstimate} disabled={!avgView || loading} className="h-10">
                {loading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <ArrowRight className="w-4 h-4 mr-2" />
                )}
                Estimate
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Result Section */}
        {result && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Main Price Card */}
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="pt-6">
                <div className="text-center space-y-3">
                  <p className="text-sm text-muted-foreground">Estimated Price per Video</p>
                  <div className="flex items-center justify-center gap-6">
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Low</p>
                      <p className="text-lg font-semibold text-muted-foreground">{formatCurrency(result.price_range.low)}</p>
                    </div>
                    <div>
                      <p className="text-4xl font-bold text-primary">{formatCurrency(result.estimated_price)}</p>
                    </div>
                    <div className="text-left">
                      <p className="text-xs text-muted-foreground">High</p>
                      <p className="text-lg font-semibold text-muted-foreground">{formatCurrency(result.price_range.high)}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <Badge variant="secondary">{result.tier}</Badge>
                    <Badge variant={result.confidence === 'high' ? 'default' : result.confidence === 'medium' ? 'secondary' : 'outline'}>
                      {result.confidence} confidence
                    </Badge>
                    {result.sample_size > 0 && (
                      <Badge variant="outline" className="text-xs">
                        {result.sample_size} similar creators
                      </Badge>
                    )}
                    {result.gmv_multiplier > 1 && (
                      <Badge variant="outline" className="text-emerald-600 border-emerald-300">
                        GMV bonus +{Math.round((result.gmv_multiplier - 1) * 100)}%
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Comparable Creators */}
            {result.comparable_creators.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Similar Creators (by avg views)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {result.comparable_creators.map((c, i) => (
                      <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50">
                        <div>
                          <a
                            href={`https://www.tiktok.com/@${(c.handle || '').replace(/^@/, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-sm font-medium text-blue-600 hover:underline inline-flex items-center gap-1"
                          >
                            @{c.handle?.replace('@', '')}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                          <div className="flex gap-3 mt-0.5">
                            <span className="text-xs text-muted-foreground">
                              Views: {c.avg_view ? formatNumber(parseFloat(c.avg_view)) : 'N/A'}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              GMV: {c.gmv ? formatCurrency(parseFloat(c.gmv)) : 'N/A'}
                            </span>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold">
                            {c.price_per_video ? formatCurrency(parseFloat(c.price_per_video)) : '—'}
                            <span className="text-xs text-muted-foreground font-normal">/video</span>
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
