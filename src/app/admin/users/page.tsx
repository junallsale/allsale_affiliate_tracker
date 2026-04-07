'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { UserPlus, Trash2, Shield, Eye, Briefcase, Wrench } from 'lucide-react';
import { createAdminUser, listAdminUsers, deleteAdminUser, listBrands } from './actions';
import { useUserRole } from '@/hooks/useUserRole';

type UserRole = 'super_admin' | 'brand_manager' | 'brand_viewer' | 'operator';

interface AdminUser {
  id: string;
  auth_id: string;
  email: string;
  name: string;
  role: UserRole;
  created_at: string;
  brand_manager_assignments?: {
    brand_id: string;
    brands: { id: string; name: string } | null;
  }[];
}

interface BrandOption {
  id: string;
  name: string;
}

const ROLE_CONFIG: Record<UserRole, { label: string; icon: typeof Shield; color: string }> = {
  super_admin: { label: 'Super Admin', icon: Shield, color: 'bg-red-100 text-red-700' },
  brand_manager: { label: 'Brand Manager', icon: Briefcase, color: 'bg-blue-100 text-blue-700' },
  brand_viewer: { label: 'Brand Viewer', icon: Eye, color: 'bg-green-100 text-green-700' },
  operator: { label: 'Operator', icon: Wrench, color: 'bg-purple-100 text-purple-700' },
};

export default function AdminUsersPage() {
  const { isAdmin } = useUserRole();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('operator');
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const [usersResult, brandsResult] = await Promise.all([
      listAdminUsers(),
      listBrands(),
    ]);
    setUsers((usersResult.users || []) as AdminUser[]);
    setBrands(brandsResult);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <p className="text-muted-foreground">Super Admin only</p>
      </div>
    );
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!name.trim() || !email.trim() || !password.trim()) {
      setFormError('Name, email and password are required');
      return;
    }
    if (password.length < 6) {
      setFormError('Password must be at least 6 characters');
      return;
    }

    setSubmitting(true);
    const result = await createAdminUser(
      email.trim(),
      password,
      name.trim(),
      role,
      (role === 'brand_viewer' || role === 'brand_manager') ? selectedBrands : undefined
    );
    setSubmitting(false);

    if (result.error) {
      setFormError(result.error);
      return;
    }

    // Reset form & refresh
    setName('');
    setEmail('');
    setPassword('');
    setRole('operator');
    setSelectedBrands([]);
    setDialogOpen(false);
    fetchData();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const result = await deleteAdminUser(deleteTarget.auth_id);
    if (result.error) {
      alert(`Error: ${result.error}`);
    }
    setDeleteTarget(null);
    fetchData();
  };

  const toggleBrand = (brandId: string) => {
    setSelectedBrands((prev) =>
      prev.includes(brandId)
        ? prev.filter((id) => id !== brandId)
        : [...prev, brandId]
    );
  };

  const selectClass =
    'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage admin accounts and roles
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <UserPlus className="h-4 w-4 mr-2" />
          Add User
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <p className="text-sm text-muted-foreground">{users.length} users</p>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-6 py-3 font-medium">Name</th>
                  <th className="px-6 py-3 font-medium">Email</th>
                  <th className="px-6 py-3 font-medium">Role</th>
                  <th className="px-6 py-3 font-medium">Brands</th>
                  <th className="px-6 py-3 font-medium">Created</th>
                  <th className="px-6 py-3 font-medium w-10"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const roleConfig = ROLE_CONFIG[user.role] || ROLE_CONFIG.operator;
                  const RoleIcon = roleConfig.icon;
                  const assignedBrands = (user.brand_manager_assignments || [])
                    .map((a) => a.brands?.name)
                    .filter(Boolean);

                  return (
                    <tr key={user.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-6 py-3 text-sm font-medium">{user.name}</td>
                      <td className="px-6 py-3 text-sm text-muted-foreground">{user.email}</td>
                      <td className="px-6 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${roleConfig.color}`}>
                          <RoleIcon className="h-3 w-3" />
                          {roleConfig.label}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-sm text-muted-foreground">
                        {assignedBrands.length > 0 ? assignedBrands.join(', ') : '-'}
                      </td>
                      <td className="px-6 py-3 text-sm text-muted-foreground">
                        {new Date(user.created_at).toLocaleDateString('ko-KR')}
                      </td>
                      <td className="px-6 py-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteTarget(user)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Add User Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Add User
            </DialogTitle>
            <DialogDescription>
              Create a new admin account with Supabase Auth.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4">
            {formError && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {formError}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="new-name">Name</Label>
              <Input
                id="new-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Chloe Kim"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-email">Email</Label>
              <Input
                id="new-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-password">Password</Label>
              <Input
                id="new-password"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 6 characters"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-role">Role</Label>
              <select
                id="new-role"
                value={role}
                onChange={(e) => {
                  setRole(e.target.value as UserRole);
                  setSelectedBrands([]);
                }}
                className={selectClass}
              >
                <option value="super_admin">Super Admin</option>
                <option value="brand_manager">Brand Manager</option>
                <option value="brand_viewer">Brand Viewer</option>
                <option value="operator">Operator</option>
              </select>
            </div>

            {(role === 'brand_viewer' || role === 'brand_manager') && (
              <div className="space-y-2">
                <Label>Assigned Brands</Label>
                <div className="border rounded-md p-3 max-h-40 overflow-y-auto space-y-2">
                  {brands.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No brands</p>
                  ) : (
                    brands.map((brand) => (
                      <label key={brand.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedBrands.includes(brand.id)}
                          onChange={() => toggleBrand(brand.id)}
                          className="rounded"
                        />
                        {brand.name}
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Creating...' : 'Create User'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.email}</strong>?
              This will remove both the auth account and admin_users record.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
