'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Users } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { adminApi } from '@/lib/api-client';
import { AddUserModal } from './add-user-modal';
import { EditUserModal } from './edit-user-modal';
import { DeleteUserConfirmModal } from './delete-user-confirm-modal';
import type { TenantUser } from '@/types/api.types';

const ROLE_BADGE: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-700',
  manager: 'bg-blue-100 text-blue-700',
};

export function TenantUsersSection({ tenantId }: { tenantId: string }) {
  const token = useAuthStore((s) => s.token ?? '');
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<TenantUser | null>(null);
  const [deletingUser, setDeletingUser] = useState<TenantUser | null>(null);

  const { data: users = [], isLoading, isError } = useQuery({
    queryKey: ['tenant-users', tenantId],
    queryFn: () => adminApi.getUsers(tenantId, token),
    enabled: Boolean(token),
  });

  const toggleActive = useMutation({
    mutationFn: ({ userId, isActive }: { userId: string; isActive: boolean }) =>
      adminApi.setUserActive(tenantId, userId, isActive, token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tenant-users', tenantId] }),
  });

  return (
    <div className="mt-4 rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Users</h2>
          {users.length > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {users.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" />
          Add User
        </button>
      </div>

      {isLoading ? (
        <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">Loading…</div>
      ) : isError ? (
        <div className="flex h-24 items-center justify-center text-sm text-destructive">Failed to load users.</div>
      ) : users.length === 0 ? (
        <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">No users yet.</div>
      ) : (
        <div className="divide-y divide-border">
          {users.map((user) => (
            <div key={user.id} className="flex items-center justify-between px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              </div>
              <div className="ml-4 flex shrink-0 items-center gap-2">
                {user.role && (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_BADGE[user.role] ?? 'bg-muted text-muted-foreground'}`}>
                    {user.role}
                  </span>
                )}
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${user.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                  {user.is_active ? 'Active' : 'Disabled'}
                </span>
                <button
                  onClick={() => toggleActive.mutate({ userId: user.id, isActive: !user.is_active })}
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  {user.is_active ? 'Disable' : 'Enable'}
                </button>
                <button onClick={() => setEditingUser(user)} aria-label="Edit"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setDeletingUser(user)} aria-label="Delete"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AddUserModal tenantId={tenantId} open={addOpen} onClose={() => setAddOpen(false)} />
      {editingUser && (
        <EditUserModal tenantId={tenantId} user={editingUser} onClose={() => setEditingUser(null)} />
      )}
      {deletingUser && (
        <DeleteUserConfirmModal tenantId={tenantId} user={deletingUser} onClose={() => setDeletingUser(null)} />
      )}
    </div>
  );
}
