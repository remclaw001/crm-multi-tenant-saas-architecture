'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { adminApi } from '@/lib/api-client';
import type { TenantUser } from '@/types/api.types';

interface Props {
  tenantId: string;
  user: TenantUser;
  onClose: () => void;
}

export function DeleteUserConfirmModal({ tenantId, user, onClose }: Props) {
  const token = useAuthStore((s) => s.token ?? '');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => adminApi.deleteUser(tenantId, user.id, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-users', tenantId] });
      onClose();
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget && !mutation.isPending) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-label="Delete User"
        className="w-full max-w-sm rounded-lg border border-border bg-card shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold">Delete User</h2>
          <button type="button" onClick={onClose} disabled={mutation.isPending} aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5">
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete{' '}
            <span className="font-medium text-foreground">{user.name}</span>?
            This action cannot be undone.
          </p>
          {mutation.isError && (
            <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
              Failed to delete user. Please try again.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <button type="button" onClick={onClose} disabled={mutation.isPending}
            className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >Cancel</button>
          <button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >{mutation.isPending ? 'Deleting…' : 'Delete'}</button>
        </div>
      </div>
    </div>
  );
}
