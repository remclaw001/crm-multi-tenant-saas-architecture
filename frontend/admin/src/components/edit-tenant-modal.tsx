'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { adminApi } from '@/lib/api-client';
import type { Tenant } from '@/types/api.types';

interface Props {
  tenant: Tenant;
  onClose: () => void;
}

interface FormState {
  name: string;
  active: boolean;
}

export function EditTenantModal({ tenant, onClose }: Props) {
  const token = useAuthStore((s) => s.token ?? '');
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>({
    name: tenant.name,
    active: tenant.status === 'active',
  });
  const [nameError, setNameError] = useState('');
  const [apiError, setApiError] = useState('');

  useEffect(() => {
    setForm({ name: tenant.name, active: tenant.status === 'active' });
    setNameError('');
    setApiError('');
  }, [tenant.id]);

  const mutation = useMutation({
    mutationFn: () =>
      adminApi.updateTenant(
        tenant.id,
        { name: form.name.trim(), status: form.active ? 'active' : 'suspended' },
        token,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      queryClient.invalidateQueries({ queryKey: ['tenants', tenant.id] });
      onClose();
    },
    onError: () => {
      setApiError('Failed to save. Please try again.');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError('');
    if (!form.name.trim()) {
      setNameError('Name is required');
      return;
    }
    mutation.mutate();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget && !mutation.isPending) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit Tenant"
        className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold">Edit Tenant</h2>
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

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate>
          <div className="space-y-4 px-6 py-5">
            {/* Name */}
            <div>
              <label htmlFor="edit-tenant-name" className="mb-1.5 block text-sm font-medium">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                id="edit-tenant-name"
                type="text"
                value={form.name}
                onChange={(e) => {
                  setForm((prev) => ({ ...prev, name: e.target.value }));
                  if (nameError) setNameError('');
                }}
                className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                  nameError ? 'border-red-500' : 'border-border'
                }`}
              />
              {nameError && <p className="mt-1 text-xs text-red-500">{nameError}</p>}
            </div>

            {/* Active toggle */}
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
              <label htmlFor="edit-tenant-active" className="text-sm font-medium">
                Active
              </label>
              <button
                id="edit-tenant-active"
                type="button"
                role="switch"
                aria-checked={form.active}
                onClick={() => setForm((prev) => ({ ...prev, active: !prev.active }))}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
                  form.active ? 'bg-primary' : 'bg-muted-foreground/30'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    form.active ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* API Error */}
            {apiError && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{apiError}</p>
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
              type="submit"
              disabled={mutation.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {mutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
