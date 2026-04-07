'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import Image from 'next/image';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const supabase = createSupabaseBrowser();
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError('이메일 또는 비밀번호가 올바르지 않습니다.');
        return;
      }

      // Check user role and redirect accordingly
      const userId = data.user?.id;
      if (userId) {
        const { data: adminUser } = await supabase
          .from('admin_users')
          .select('id, role')
          .eq('auth_id', userId)
          .single();

        if (adminUser?.role === 'brand_viewer') {
          const { data: assignments } = await supabase
            .from('brand_manager_assignments')
            .select('brands(slug)')
            .eq('admin_user_id', adminUser.id);

          const slug = (assignments || [])
            .map((a: Record<string, unknown>) => {
              const brands = a.brands as { slug: string } | null;
              return brands?.slug;
            })
            .find(Boolean);

          if (slug) {
            router.push(`/admin/brands/${slug}`);
            router.refresh();
            return;
          }
        }
      }

      router.push('/admin/brands');
      router.refresh();
    } catch {
      setError('로그인 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center pb-2">
          <div className="flex justify-center mb-4">
            <div className="h-14 w-14 rounded-xl overflow-hidden bg-black flex items-center justify-center">
              <Image src="/logo.png" alt="ALLSALE" width={56} height={56} className="object-cover" />
            </div>
          </div>
          <h1 className="text-xl font-semibold">ALLSALE Admin</h1>
          <p className="text-sm text-muted-foreground">어드민 패널에 로그인하세요</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">이메일</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@allsale.ai"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">비밀번호</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <p className="text-sm text-red-500 text-center">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '로그인 중...' : '로그인'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
