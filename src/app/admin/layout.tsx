'use client';

import { Building2, Users, LogOut, Database, Banknote, Star, X, ClipboardCheck, Calculator, UserCog, Menu, DollarSign, Bell, Check, Mail, Search, Loader2 } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import type { UserRole } from '@/hooks/useUserRole';
import { useFavoriteProjects } from '@/hooks/useFavoriteProjects';
import { isDemoBrandId } from '@/lib/demo';

type NavLink = { label: string; href: string; icon: typeof Database; roles: UserRole[] };

const adminNavLinks: NavLink[] = [
  { label: 'Affiliates', href: '/admin/affiliates', icon: Database, roles: ['super_admin', 'operator'] },
  { label: 'Brands', href: '/admin/brands', icon: Building2, roles: ['super_admin', 'operator'] },
  { label: 'Creators', href: '/admin/creators', icon: Users, roles: ['super_admin', 'operator'] },
  { label: 'Checklist', href: '/admin/checklist', icon: ClipboardCheck, roles: ['super_admin', 'operator'] },
  { label: 'Pricing', href: '/admin/pricing', icon: Calculator, roles: ['super_admin', 'operator'] },
  { label: 'Email Queue', href: '/admin/email-queue', icon: Mail, roles: ['super_admin', 'operator'] },
];

const adminOnlyNavLinks: NavLink[] = [
  { label: 'Payments', href: '/admin/payments', icon: Banknote, roles: ['super_admin'] },
  { label: 'Finance', href: '/admin/finance', icon: DollarSign, roles: ['super_admin'] },
  { label: 'Users', href: '/admin/users', icon: UserCog, roles: ['super_admin'] },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  // Role is resolved from the DB (admin_users), not from cookies, so a missing
  // or stale cookie can never expose menus the user isn't allowed to see.
  const [role, setRole] = useState<UserRole | null>(null);
  const [assignedBrandSlugs, setAssignedBrandSlugs] = useState<string[]>([]);
  const isBrandViewer = role === 'brand_viewer';
  const isAdmin = role === 'super_admin';
  const [deniedMsg, setDeniedMsg] = useState<string | null>(null);
  const { favorites, toggleFavorite } = useFavoriteProjects();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Notifications
  const [notifications, setNotifications] = useState<{ id: string; title: string; body: string | null; link: string | null; is_read: boolean; created_at: string }[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const unreadCount = notifications.filter(n => !n.is_read).length;

  // Checklist badge
  const [checklistBadgeCount, setChecklistBadgeCount] = useState(0);

  // Project creator search
  type PCSearchResult = {
    pc_id: string;
    project_id: string;
    brand_slug: string;
    creator_name: string;
    tiktok_handle: string | null;
    creator_email: string | null;
    project_name: string;
    brand_name: string;
  };
  const [pcSearchQuery, setPcSearchQuery] = useState('');
  const [pcSearchResults, setPcSearchResults] = useState<PCSearchResult[]>([]);
  const [pcSearchOpen, setPcSearchOpen] = useState(false);
  const [pcSearching, setPcSearching] = useState(false);

  const fetchChecklistBadge = useCallback(async () => {
    const supabase = createSupabaseBrowser();
    // Needs Review: count unique non-deleted project_creators with active reviews
    const { data: reviewRows } = await supabase
      .from('project_creators')
      .select('id, projects(brand_id), project_creator_reviews!inner(status)')
      .or('is_deleted.is.null,is_deleted.eq.false')
      .in('project_creator_reviews.status', ['need_review', 'in_progress']);
    const reviewCount = (reviewRows || []).filter(
      (r: any) => !isDemoBrandId(r.projects?.brand_id)
    ).length;
    // Posting Complete: signed + all videos submitted + not confirmed
    const { data: pcRows } = await supabase
      .from('project_creators')
      .select('id, assigned_video_count, projects(brand_id), videos(id, status)')
      .not('signed_at', 'is', null)
      .eq('posting_confirmed', false)
      .or('is_deleted.is.null,is_deleted.eq.false');
    const postingCount = (pcRows || []).filter(
      (r: any) => !isDemoBrandId(r.projects?.brand_id) &&
        ((r.videos as any[]) || []).filter((v: any) => v.status !== 'rejected').length >= ((r as any).assigned_video_count || 1)
    ).length;
    setChecklistBadgeCount(reviewCount + postingCount);
  }, []);

  const fetchNotifications = useCallback(async () => {
    const supabase = createSupabaseBrowser();
    const { data: { session } } = await supabase.auth.getSession();
    const userName = session?.user?.email?.split('@')[0];
    if (!userName) return;
    const { data } = await supabase
      .from('notifications')
      .select('id, title, body, link, is_read, created_at')
      .eq('recipient', userName)
      .order('created_at', { ascending: false })
      .limit(50);
    if (data) setNotifications(data);
  }, []);

  useEffect(() => {
    const q = pcSearchQuery.trim();
    if (q.length < 2) {
      setPcSearchResults([]);
      setPcSearching(false);
      return;
    }
    setPcSearching(true);
    const handle = setTimeout(async () => {
      const supabase = createSupabaseBrowser();
      const like = `%${q}%`;
      const { data: creators } = await supabase
        .from('creators')
        .select('id, name, tiktok_handle, email')
        .or(`name.ilike.${like},tiktok_handle.ilike.${like},email.ilike.${like}`)
        .limit(30);
      if (!creators || creators.length === 0) {
        setPcSearchResults([]);
        setPcSearching(false);
        return;
      }
      const creatorIds = creators.map((c: any) => c.id);
      const { data: pcs } = await supabase
        .from('project_creators')
        .select('id, project_id, creator_id, projects(id, name, brand_id, brands(name, slug))')
        .in('creator_id', creatorIds)
        .or('is_deleted.is.null,is_deleted.eq.false')
        .order('created_at', { ascending: false })
        .limit(40);
      const creatorMap = new Map(creators.map((c: any) => [c.id, c]));
      const results: PCSearchResult[] = (pcs || [])
        .map((pc: any) => {
          const c = creatorMap.get(pc.creator_id);
          if (!c || !pc.projects?.brands?.slug) return null;
          if (isDemoBrandId(pc.projects?.brand_id)) return null;
          return {
            pc_id: pc.id,
            project_id: pc.project_id,
            brand_slug: pc.projects.brands.slug,
            creator_name: c.name,
            tiktok_handle: c.tiktok_handle,
            creator_email: c.email,
            project_name: pc.projects.name,
            brand_name: pc.projects.brands.name,
          };
        })
        .filter(Boolean) as PCSearchResult[];
      setPcSearchResults(results);
      setPcSearching(false);
    }, 250);
    return () => clearTimeout(handle);
  }, [pcSearchQuery]);

  const markAsRead = async (id: string) => {
    const supabase = createSupabaseBrowser();
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  };

  const markAllAsRead = async () => {
    const supabase = createSupabaseBrowser();
    const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id);
    if (unreadIds.length === 0) return;
    await supabase.from('notifications').update({ is_read: true }).in('id', unreadIds);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
  };

  const isLoginPage = pathname === '/admin/login';

  // Close sidebar on navigation
  useEffect(() => {
    setSidebarOpen(false);
    setPcSearchOpen(false);
    setPcSearchQuery('');
  }, [pathname]);

  // Auto-dismiss the permission-denied toast
  useEffect(() => {
    if (!deniedMsg) return;
    const t = setTimeout(() => setDeniedMsg(null), 4000);
    return () => clearTimeout(t);
  }, [deniedMsg]);

  useEffect(() => {
    const checkAuth = async () => {
      const supabase = createSupabaseBrowser();
      const { data: { session } } = await supabase.auth.getSession();

      if (session?.user) {
        setIsAuthenticated(true);
        setUserEmail(session.user.email || '');

        // Resolve role + assigned brands directly from the DB
        const { data: adminUser } = await supabase
          .from('admin_users')
          .select('id, role')
          .eq('auth_id', session.user.id)
          .single();
        const resolvedRole = (adminUser?.role || 'operator') as UserRole;
        setRole(resolvedRole);

        if (resolvedRole === 'brand_viewer' || resolvedRole === 'brand_manager') {
          const { data: assignments } = await supabase
            .from('brand_manager_assignments')
            .select('brands(slug)')
            .eq('admin_user_id', adminUser!.id);
          const slugs = (assignments || [])
            .map((a: Record<string, unknown>) => (a.brands as { slug: string } | null)?.slug)
            .filter((s): s is string => Boolean(s));
          setAssignedBrandSlugs(slugs);
        } else {
          setAssignedBrandSlugs([]);
        }

        fetchNotifications();
        fetchChecklistBadge();
      } else if (!isLoginPage) {
        router.replace('/admin/login');
        return;
      }
      setAuthChecked(true);
    };

    checkAuth();

    // Listen for auth changes
    const supabase = createSupabaseBrowser();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setIsAuthenticated(false);
        setUserEmail('');
        router.replace('/admin/login');
      } else if (session?.user) {
        setIsAuthenticated(true);
        setUserEmail(session.user.email || '');
      }
    });

    return () => subscription.unsubscribe();
  }, [isLoginPage, router]);

  const handleLogout = async () => {
    const supabase = createSupabaseBrowser();
    await supabase.auth.signOut();
    // Clear role cookies
    document.cookie = 'x-user-role=; path=/; max-age=0';
    document.cookie = 'x-brand-slugs=; path=/; max-age=0';
  };

  // Login page: render without sidebar
  if (isLoginPage) {
    if (!authChecked) {
      return null; // prevent flash
    }
    return <>{children}</>;
  }

  // Not authenticated, or role not yet resolved: show nothing while loading.
  // Waiting for `role` prevents a flash of admin menus before the DB confirms
  // the user's actual permissions.
  if (!authChecked || !isAuthenticated || role === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <div className="animate-pulse text-muted-foreground">로딩 중...</div>
      </div>
    );
  }

  // Build nav links based on role
  const navLinks: NavLink[] = isBrandViewer
    ? assignedBrandSlugs.map(slug => ({
        label: 'Dashboard',
        href: `/admin/brands/${slug}`,
        icon: Building2,
        roles: ['brand_viewer'] as UserRole[],
      }))
    : [...adminNavLinks, ...adminOnlyNavLinks].filter(link => link.roles.includes(role));

  // Brand viewer: no sidebar, just content + top-right logout button
  if (isBrandViewer) {
    return (
      <div className="min-h-screen bg-muted/30">
        {/* Minimal top bar with logout only */}
        <div className="fixed top-0 right-0 z-50 p-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            onClick={handleLogout}
            title="로그아웃"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
        <div className="p-8">{children}</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* Permission-denied toast */}
      {deniedMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm text-white shadow-lg">
          <X className="h-4 w-4 shrink-0" />
          <span>{deniedMsg}</span>
        </div>
      )}

      {/* Mobile hamburger */}
      <div className="fixed top-0 left-0 z-[60] p-3 md:hidden">
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 p-0"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-[55] bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        'fixed inset-y-0 left-0 z-[60] w-[260px] border-r border-sidebar-border bg-sidebar flex flex-col transition-transform duration-200',
        'md:translate-x-0',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      )}>
        <div className="flex h-16 items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg overflow-hidden bg-black">
              <Image src="/logo.png" alt="ALLSALE" width={36} height={36} className="object-cover" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-sidebar-foreground">ALLSALE</span>
              <span className="text-xs text-sidebar-foreground/60">Affiliate Tracker</span>
            </div>
          </div>
          <button
            onClick={() => { setNotifOpen(!notifOpen); if (!notifOpen) fetchNotifications(); }}
            className="relative p-1.5 rounded-md hover:bg-sidebar-accent transition-colors"
          >
            <Bell className="w-4 h-4 text-sidebar-foreground/70" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        </div>
        <Separator />

        {/* Notification Panel */}
        {notifOpen && (
          <div className="border-b bg-background/95 max-h-[300px] overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-2 sticky top-0 bg-background/95 backdrop-blur-sm border-b">
              <span className="text-xs font-semibold text-muted-foreground">Notifications</span>
              {unreadCount > 0 && (
                <button onClick={markAllAsRead} className="text-[10px] text-blue-600 hover:underline">
                  Mark all read
                </button>
              )}
            </div>
            {notifications.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">No notifications</p>
            ) : (
              notifications.map(n => (
                <button
                  key={n.id}
                  className={cn(
                    'w-full text-left px-4 py-2.5 border-b last:border-0 hover:bg-muted/50 transition-colors',
                    !n.is_read && 'bg-blue-50 dark:bg-blue-950/20'
                  )}
                  onClick={() => {
                    markAsRead(n.id);
                    if (n.link) router.push(n.link);
                    setNotifOpen(false);
                  }}
                >
                  <p className={cn('text-xs', !n.is_read ? 'font-semibold' : 'text-muted-foreground')}>{n.title}</p>
                  {n.body && <p className="text-xs text-muted-foreground mt-0.5 truncate">{n.body}</p>}
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                    {new Date(n.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </button>
              ))
            )}
          </div>
        )}

        {/* Project creator search */}
        {!isBrandViewer && (
          <div className="px-3 pt-3 pb-1 relative">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-sidebar-foreground/40" />
              <input
                type="text"
                value={pcSearchQuery}
                onChange={(e) => { setPcSearchQuery(e.target.value); setPcSearchOpen(true); }}
                onFocus={() => setPcSearchOpen(true)}
                placeholder="Search project creator..."
                className="w-full h-8 pl-8 pr-7 text-xs rounded-md bg-sidebar-accent/40 border border-sidebar-border/60 text-sidebar-foreground placeholder:text-sidebar-foreground/40 focus:outline-none focus:ring-1 focus:ring-sidebar-ring/60"
              />
              {pcSearching ? (
                <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-sidebar-foreground/40 animate-spin" />
              ) : pcSearchQuery && (
                <button
                  onClick={() => { setPcSearchQuery(''); setPcSearchResults([]); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-sidebar-foreground/40 hover:text-sidebar-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {pcSearchOpen && pcSearchQuery.trim().length >= 2 && (
              <div className="absolute left-3 right-3 mt-1 z-50 rounded-md border border-sidebar-border bg-background shadow-lg max-h-[320px] overflow-y-auto">
                {pcSearching && pcSearchResults.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">Searching...</p>
                ) : pcSearchResults.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No results</p>
                ) : (
                  pcSearchResults.map((r) => (
                    <button
                      key={r.pc_id}
                      onClick={() => {
                        router.push(`/admin/brands/${r.brand_slug}/projects/${r.project_id}/creators/${r.pc_id}`);
                        setPcSearchOpen(false);
                        setPcSearchQuery('');
                      }}
                      className="w-full text-left px-3 py-2 border-b last:border-0 hover:bg-muted/50 transition-colors"
                    >
                      <p className="text-xs font-medium truncate">
                        {r.creator_name}
                        {r.tiktok_handle && (
                          <span className="text-muted-foreground font-normal ml-1">@{r.tiktok_handle}</span>
                        )}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                        {r.brand_name} / {r.project_name}
                      </p>
                      {r.creator_email && (
                        <p className="text-[10px] text-muted-foreground/70 truncate">{r.creator_email}</p>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        <nav className="space-y-1 px-3 py-4 flex-1 overflow-y-auto">
          {navLinks.map((link) => {
            const Icon = link.icon;
            const isActive = pathname.startsWith(link.href);
            const badgeCount = link.href === '/admin/checklist' ? checklistBadgeCount : 0;
            const allowed = link.roles.includes(role);
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={(e) => {
                  if (!allowed) {
                    e.preventDefault();
                    setDeniedMsg(`You don't have permission to access "${link.label}".`);
                  }
                }}
                aria-disabled={!allowed}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                  isActive
                    ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
                  !allowed && 'opacity-50 cursor-not-allowed'
                )}
              >
                <Icon className="h-4 w-4" />
                {link.label}
                {badgeCount > 0 && (
                  <span className="ml-auto min-w-5 h-5 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold px-1">
                    {badgeCount > 99 ? '99+' : badgeCount}
                  </span>
                )}
              </Link>
            );
          })}
          {favorites.length > 0 && (
            <>
              <Separator className="my-2" />
              <p className="px-3 py-1 text-xs font-medium text-sidebar-foreground/50 uppercase tracking-wider">
                Favorites
              </p>
              {favorites.map((fav) => {
                const favHref = `/admin/brands/${fav.brandSlug}/projects/${fav.id}`;
                const isFavActive = pathname.startsWith(favHref);
                return (
                  <div
                    key={fav.id}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors group',
                      isFavActive
                        ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                    )}
                  >
                    <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400 shrink-0" />
                    <Link href={favHref} className="flex-1 min-w-0 truncate">
                      <span className="truncate">{fav.name}</span>
                      <span className="text-xs text-sidebar-foreground/40 ml-1">{fav.brandName}</span>
                    </Link>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleFavorite(fav);
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      title="Remove from favorites"
                    >
                      <X className="h-3 w-3 text-sidebar-foreground/40 hover:text-sidebar-foreground" />
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </nav>

        {/* User & Logout */}
        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-sidebar-foreground truncate">{userEmail}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-sidebar-foreground/60 hover:text-sidebar-foreground"
              onClick={handleLogout}
              title="로그아웃"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 md:pl-[260px]">
        <div className="min-h-screen bg-muted/30">
          <div className="p-4 pt-14 md:p-8 md:pt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}
