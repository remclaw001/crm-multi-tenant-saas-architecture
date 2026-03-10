'use client';

import { useState, useEffect } from 'react';
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

interface FormState {
  name: string;
  email: string;
  role: 'admin' | 'manager';
  resetPassword: boolean;
  password: string;
}

interface FormErrors {
  name?: string;
  email?: string;
  password?: string;
}

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!form.name.trim()) errors.name = 'Name is required';
  if (!form.email.trim()) {
    errors.email = 'Email is required';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errors.email = 'Please enter a valid email';
  }
  if (form.resetPassword) {
    if (!form.password) errors.password = 'Password is required';
    else if (form.password.length < 8) errors.password = 'Minimum 8 characters';
  }
  return errors;
}

export function EditUserModal({ tenantId, user, onClose }: Props) {
  const token = useAuthStore((s) => s.token ?? '');
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>({
    name: user.name,
    email: user.email,
    role: user.role === 'admin' ? 'admin' : 'manager',
    resetPassword: false,
    password: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [apiError, setApiError] = useState('');

  useEffect(() => {
    setForm({ name: user.name, email: user.email, role: user.role === 'admin' ? 'admin' : 'manager', resetPassword: false, password: '' });
    setErrors({});
    setApiError('');
  }, [user.id]);

  const mutation = useMutation({
    mutationFn: () =>
      adminApi.updateUser(tenantId, user.id, {
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        ...(form.resetPassword ? { password: form.password } : {}),
      }, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-users', tenantId] });
      onClose();
    },
    onError: (err: any) => {
      setApiError(err?.body?.detail ?? 'Failed to save. Please try again.');
    },
  });

  function handleChange(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = e.target.type === 'checkbox'
        ? (e.target as HTMLInputElement).checked
        : e.target.value;
      setForm((prev) => ({ ...prev, [field]: value }));
      if (errors[field as keyof FormErrors]) setErrors((prev) => ({ ...prev, [field]: undefined }));
    };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError('');
    const validationErrors = validate(form);
    if (Object.keys(validationErrors).length > 0) { setErrors(validationErrors); return; }
    mutation.mutate();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget && !mutation.isPending) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-label="Edit User"
        className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold">Edit User</h2>
          <button type="button" onClick={onClose} disabled={mutation.isPending} aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="space-y-4 px-6 py-5">
            <div>
              <label htmlFor="edit-user-name" className="mb-1.5 block text-sm font-medium">
                Name <span className="text-red-500">*</span>
              </label>
              <input id="edit-user-name" type="text" value={form.name} onChange={handleChange('name')}
                className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${errors.name ? 'border-red-500' : 'border-border'}`}
              />
              {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
            </div>

            <div>
              <label htmlFor="edit-user-email" className="mb-1.5 block text-sm font-medium">
                Email <span className="text-red-500">*</span>
              </label>
              <input id="edit-user-email" type="email" value={form.email} onChange={handleChange('email')}
                className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${errors.email ? 'border-red-500' : 'border-border'}`}
              />
              {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email}</p>}
            </div>

            <div>
              <label htmlFor="edit-user-role" className="mb-1.5 block text-sm font-medium">Role</label>
              <select id="edit-user-role" value={form.role} onChange={handleChange('role')}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input id="reset-password" type="checkbox" checked={form.resetPassword}
                onChange={handleChange('resetPassword')}
                className="h-4 w-4 rounded border-border"
              />
              <label htmlFor="reset-password" className="text-sm font-medium cursor-pointer">Reset password</label>
            </div>

            {form.resetPassword && (
              <div>
                <label htmlFor="edit-user-password" className="mb-1.5 block text-sm font-medium">
                  New Password <span className="text-red-500">*</span>
                </label>
                <input id="edit-user-password" type="password" value={form.password}
                  onChange={handleChange('password')}
                  className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${errors.password ? 'border-red-500' : 'border-border'}`}
                />
                {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password}</p>}
              </div>
            )}

            {apiError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{apiError}</p>}
          </div>

          <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
            <button type="button" onClick={onClose} disabled={mutation.isPending}
              className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >Cancel</button>
            <button type="submit" disabled={mutation.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >{mutation.isPending ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
