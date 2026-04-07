'use client';

import { useMemo } from 'react';

export type UserRole = 'super_admin' | 'brand_manager' | 'brand_viewer' | 'operator';

export interface UserRoleInfo {
  role: UserRole;
  isBrandViewer: boolean;
  isAdmin: boolean;
  isOperator: boolean;
  assignedBrandSlugs: string[];
}

function parseCookies(): Record<string, string> {
  if (typeof document === 'undefined') return {};
  return document.cookie.split(';').reduce((acc, c) => {
    const [key, val] = c.trim().split('=');
    if (key && val) acc[key] = decodeURIComponent(val);
    return acc;
  }, {} as Record<string, string>);
}

export function useUserRole(): UserRoleInfo {
  return useMemo(() => {
    const cookies = parseCookies();
    const role = (cookies['x-user-role'] || 'super_admin') as UserRole;
    const brandSlugs = cookies['x-brand-slugs']?.split(',').filter(Boolean) || [];

    return {
      role,
      isBrandViewer: role === 'brand_viewer',
      isAdmin: role === 'super_admin',
      isOperator: role === 'operator',
      assignedBrandSlugs: brandSlugs,
    };
  }, []);
}
