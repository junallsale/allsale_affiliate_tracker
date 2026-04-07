import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip auth check for non-admin routes
  if (!pathname.startsWith('/admin')) {
    return NextResponse.next();
  }

  // Login page: redirect authenticated users to their home
  if (pathname === '/admin/login') {
    const response = NextResponse.next();
    const supabase = createSupabaseMiddleware(request, response);
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      const redirectUrl = await getHomeUrl(supabase, user.id, request.url);
      return NextResponse.redirect(new URL(redirectUrl, request.url));
    }
    return response;
  }

  // For all /admin/* routes (except /admin/login), check auth
  const response = NextResponse.next();
  const supabase = createSupabaseMiddleware(request, response);
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL('/admin/login', request.url));
  }

  // Look up user role
  const { data: adminUser } = await supabase
    .from('admin_users')
    .select('id, role')
    .eq('auth_id', user.id)
    .single();

  const role = adminUser?.role || 'super_admin';

  // Set role cookies for client-side consumption
  response.cookies.set('x-user-role', role, {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });

  if (role === 'brand_viewer' || role === 'brand_manager') {
    // Get assigned brand slugs
    const { data: assignments } = await supabase
      .from('brand_manager_assignments')
      .select('brands(slug)')
      .eq('admin_user_id', adminUser!.id);

    const brandSlugs = (assignments || [])
      .map((a: Record<string, unknown>) => {
        const brands = a.brands as { slug: string } | null;
        return brands?.slug;
      })
      .filter((s): s is string => Boolean(s));

    response.cookies.set('x-brand-slugs', brandSlugs.join(','), {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });

    if (role === 'brand_viewer') {
      // Check if current path is allowed
      const isAllowed = pathname === '/admin/pricing' || brandSlugs.some(slug =>
        pathname === `/admin/brands/${slug}` ||
        pathname.startsWith(`/admin/brands/${slug}/`)
      );

      if (!isAllowed && brandSlugs.length > 0) {
        return NextResponse.redirect(
          new URL(`/admin/brands/${brandSlugs[0]}`, request.url)
        );
      }
    }
  } else {
    // Clear brand slugs cookie for admins
    response.cookies.set('x-brand-slugs', '', {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      maxAge: 0,
    });
  }

  return response;
}

async function getHomeUrl(
  supabase: ReturnType<typeof createSupabaseMiddleware>,
  userId: string,
  baseUrl: string
): Promise<string> {
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

    if (slug) return `/admin/brands/${slug}`;
  }

  return '/admin/brands';
}

function createSupabaseMiddleware(request: NextRequest, response: NextResponse) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );
}

export const config = {
  matcher: ['/admin/:path*'],
};
