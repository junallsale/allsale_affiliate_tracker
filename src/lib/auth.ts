import { createSupabaseServer } from './supabase-server';

export type UserRole = 'super_admin' | 'brand_manager' | 'brand_viewer';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  assignedBrandSlugs: string[];
}

export async function getAuthUser(): Promise<AuthUser | null> {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Look up admin_users record
  const { data: adminUser } = await supabase
    .from('admin_users')
    .select('id, role')
    .eq('auth_id', user.id)
    .single();

  // If no admin_users record, treat as super_admin (backward compatibility)
  if (!adminUser) {
    return {
      id: user.id,
      email: user.email || '',
      role: 'super_admin',
      assignedBrandSlugs: [],
    };
  }

  let assignedBrandSlugs: string[] = [];
  if (adminUser.role === 'brand_viewer' || adminUser.role === 'brand_manager') {
    const { data: assignments } = await supabase
      .from('brand_manager_assignments')
      .select('brand_id, brands(slug)')
      .eq('admin_user_id', adminUser.id);

    assignedBrandSlugs = (assignments || [])
      .map((a: Record<string, unknown>) => {
        const brands = a.brands as { slug: string } | null;
        return brands?.slug;
      })
      .filter((s): s is string => Boolean(s));
  }

  return {
    id: user.id,
    email: user.email || '',
    role: adminUser.role as UserRole,
    assignedBrandSlugs,
  };
}
