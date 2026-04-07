'use client';

import { Building2, Users, LogOut, Database, Banknote, Star, X, ClipboardCheck, Calculator, UserCog, Menu, DollarSign, Bell, Check } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import { useUserRole } from '@/hooks/useUserRole';
import { useFavoriteProjects } from '@/hooks/useFavoriteProjects';

const adminNavLinks = [
  { label: 'Affiliates', href: '/admin/affiliates', icon: Database },
  { label: 'Brands', href: '/admin/brands', icon: Building2 },
  { label: 'Creators', href: '/admin/creators', icon: Users },
  { label: 'Checklist', href: '/admin/checklist', icon: ClipboardCheck },
  { label: 'Pricing', href: '/admin/pricing', icon: Calculator },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const { isBrandViewer, isAdmin, assignedBrandSlugs } = useUserRole();
  const { favorites, toggleFavorite } = useFavoriteProjects();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Notifications
  const [notifications, setNotifications] = useState<{ id: string; title: string; body: string | null; link: string | null; is_read: boolean; created_at: string }[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const unreadCount = notifications.filter(n => !n.is_read).length;

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
  }, [pathname]);

  useEffect(() => {
    const checkAuth = async () => {
      const supabase = createSupabaseBrowser();
      const { data: { session } } = await supabase.auth.getSession();

      if (session?.user) {
        setIsAuthenticated(true);
        setUserEmail(session.user.email || '');
        fetchNotifications();
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

  // Not authenticated and not login page: show nothing while redirecting
  if (!authChecked || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <div className="animate-pulse text-muted-foreground">로딩 중...</div>
      </div>
    );
  }

  // Build nav links based on role
  const navLinks = isBrandViewer
    ? assignedBrandSlugs.map(slug => ({
        label: 'Dashboard',
        href: `/admin/brands/${slug}`,
        icon: Building2,
      }))
    : [
        ...adminNavLinks,
        ...(isAdmin ? [
          { label: 'Payments', href: '/admin/payments', icon: Banknote },
          { label: 'Finance', href: '/admin/finance', icon: DollarSign },
          { label: 'Users', href: '/admin/users', icon: UserCog },
        ] : []),
      ];

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

        <nav className="space-y-1 px-3 py-4 flex-1">
          {navLinks.map((link) => {
            const Icon = link.icon;
            const isActive = pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                  isActive
                    ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
                {link.label}
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
