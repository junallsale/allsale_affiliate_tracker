'use server';

import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

type UserRole = 'super_admin' | 'brand_manager' | 'brand_viewer' | 'operator';

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

async function getServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );
}

async function requireSuperAdmin() {
  const supabase = await getServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: adminUser } = await supabase
    .from('admin_users')
    .select('role')
    .eq('auth_id', user.id)
    .single();

  if (adminUser?.role !== 'super_admin') {
    throw new Error('Permission denied: super_admin only');
  }
}

export async function createAdminUser(
  email: string,
  password: string,
  name: string,
  role: UserRole,
  brandIds?: string[]
) {
  await requireSuperAdmin();

  const admin = getAdminClient();

  // 1. Create auth user
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    return { error: error.message };
  }

  // 2. Insert into admin_users
  const { error: insertError } = await admin
    .from('admin_users')
    .insert({
      auth_id: data.user.id,
      email,
      name,
      role,
    });

  if (insertError) {
    // Rollback: delete auth user
    await admin.auth.admin.deleteUser(data.user.id);
    return { error: insertError.message };
  }

  // 3. If brand_viewer or brand_manager, assign brands
  if ((role === 'brand_viewer' || role === 'brand_manager') && brandIds?.length) {
    const { data: adminUserRow } = await admin
      .from('admin_users')
      .select('id')
      .eq('auth_id', data.user.id)
      .single();

    if (adminUserRow) {
      const assignments = brandIds.map((brandId) => ({
        admin_user_id: adminUserRow.id,
        brand_id: brandId,
      }));

      await admin.from('brand_manager_assignments').insert(assignments);
    }
  }

  return { success: true, userId: data.user.id };
}

export async function listAdminUsers() {
  await requireSuperAdmin();

  const admin = getAdminClient();

  const { data, error } = await admin
    .from('admin_users')
    .select(`
      id, auth_id, email, name, role, created_at,
      brand_manager_assignments(brand_id, brands(id, name))
    `)
    .order('created_at', { ascending: false });

  if (error) return { error: error.message, users: [] };

  return { users: data || [] };
}

export async function deleteAdminUser(authId: string) {
  await requireSuperAdmin();

  const admin = getAdminClient();

  // Delete from admin_users first (cascade will handle assignments)
  const { error: dbError } = await admin
    .from('admin_users')
    .delete()
    .eq('auth_id', authId);

  if (dbError) return { error: dbError.message };

  // Delete auth user
  const { error: authError } = await admin.auth.admin.deleteUser(authId);
  if (authError) return { error: authError.message };

  return { success: true };
}

export async function listBrands() {
  await requireSuperAdmin();

  const admin = getAdminClient();
  const { data } = await admin
    .from('brands')
    .select('id, name')
    .order('name');

  return data || [];
}
