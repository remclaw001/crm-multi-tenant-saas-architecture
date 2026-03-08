'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import type { Customer } from '@/types/api.types';

interface Props {
  contact: Customer;
  onClose: () => void;
  onSuccess: () => void;
}

export function DeleteContactModal({ contact, onClose, onSuccess }: Props) {
  const { token, tenantId } = useAuthStore();
  const [apiError, setApiError] = useState('');

  const mutation = useMutation({
    mutationFn: (id: string) =>
      crmApi.deleteCustomer(id, { token: token ?? '', tenantId: tenantId ?? '' }),
  });

  async function handleDelete() {
    setApiError('');
    try {
      await mutation.mutateAsync(contact.id);
      onSuccess();
      onClose();
    } catch {
      setApiError('Failed to delete. Please try again.');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget && !mutation.isPending) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-contact-title"
        className="w-full max-w-sm rounded-lg bg-card shadow-xl border border-border"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 id="delete-contact-title" className="text-base font-semibold">Delete Contact</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={mutation.isPending}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete{' '}
            <span className="font-semibold text-foreground">{contact.name}</span>?
            This action cannot be undone.
          </p>
          {apiError && (
            <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
              {apiError}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={mutation.isPending}
            className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={mutation.isPending}
            className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >
            {mutation.isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
