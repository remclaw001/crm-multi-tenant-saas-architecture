'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { adminApi } from '@/lib/api-client';
import type { Tenant } from '@/types/api.types';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface FormState {
  name: string;
  subdomain: string;
  plan: Tenant['plan'];
}

interface FormErrors {
  name?: string;
  subdomain?: string;
}

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!form.name.trim()) errors.name = 'Name is required';
  if (!form.subdomain.trim()) {
    errors.subdomain = 'Subdomain is required';
  } else if (!/^[a-z0-9-]+$/.test(form.subdomain)) {
    errors.subdomain = 'Only lowercase letters, numbers, and hyphens';
  }
  return errors;
}

export function AddTenantModal({ open, onClose }: Props) {
  const token = useAuthStore((s) => s.token ?? '');
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>({ name: '', subdomain: '', plan: 'basic' });
  const [errors, setErrors] = useState<FormErrors>({});
  const [apiError, setApiError] = useState('');

  const mutation = useMutation({
    mutationFn: (input: FormState) => adminApi.createTenant(input, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      setForm({ name: '', subdomain: '', plan: 'basic' });
      setErrors({});
      setApiError('');
      onClose();
    },
    onError: () => {
      setApiError('Failed to create tenant. Please try again.');
    },
  });

  function handleClose() {
    if (mutation.isPending) return;
    setForm({ name: '', subdomain: '', plan: 'basic' });
    setErrors({});
    setApiError('');
    onClose();
  }

  function handleChange(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
      if (errors[field as keyof FormErrors]) {
        setErrors((prev) => ({ ...prev, [field]: undefined }));
      }
    };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError('');
    const validationErrors = validate(form);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    mutation.mutate(form);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add Tenant"
        className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold">Add Tenant</h2>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
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
              <label htmlFor="tenant-name" className="mb-1.5 block text-sm font-medium">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                id="tenant-name"
                type="text"
                value={form.name}
                onChange={handleChange('name')}
                className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                  errors.name ? 'border-red-500' : 'border-border'
                }`}
              />
              {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
            </div>

            {/* Subdomain */}
            <div>
              <label htmlFor="tenant-subdomain" className="mb-1.5 block text-sm font-medium">
                Subdomain <span className="text-red-500">*</span>
              </label>
              <div className="flex items-center gap-1">
                <input
                  id="tenant-subdomain"
                  type="text"
                  value={form.subdomain}
                  onChange={handleChange('subdomain')}
                  placeholder="acme"
                  className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                    errors.subdomain ? 'border-red-500' : 'border-border'
                  }`}
                />
                <span className="shrink-0 text-sm text-muted-foreground">.app.com</span>
              </div>
              {errors.subdomain && <p className="mt-1 text-xs text-red-500">{errors.subdomain}</p>}
            </div>

            {/* Plan */}
            <div>
              <label htmlFor="tenant-plan" className="mb-1.5 block text-sm font-medium">
                Plan
              </label>
              <select
                id="tenant-plan"
                value={form.plan}
                onChange={handleChange('plan')}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="basic">Basic</option>
                <option value="premium">Premium</option>
                <option value="enterprise">Enterprise</option>
                <option value="vip">VIP</option>
              </select>
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
              onClick={handleClose}
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
              {mutation.isPending ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
