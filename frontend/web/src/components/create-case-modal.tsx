'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type Priority = 'low' | 'medium' | 'high';

interface FormState {
  customer_id: string;
  title: string;
  description: string;
  priority: Priority;
}

interface FormErrors {
  customer_id?: string;
  title?: string;
}

const EMPTY_FORM: FormState = {
  customer_id: '',
  title: '',
  description: '',
  priority: 'medium',
};

const PRIORITIES: Priority[] = ['low', 'medium', 'high'];

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!form.customer_id) errors.customer_id = 'Customer is required';
  if (!form.title.trim()) errors.title = 'Title is required';
  return errors;
}

export function CreateCaseModal({ open, onClose, onSuccess }: Props) {
  const { token, tenantId } = useAuthStore();
  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [apiError, setApiError] = useState('');

  const { data: customersData, isLoading: loadingCustomers, isError: customersError } = useQuery({
    queryKey: ['customers', tenantId],
    queryFn: () => crmApi.getCustomers(ctx),
    enabled: open && Boolean(token && tenantId),
  });

  const mutation = useMutation({
    mutationFn: (input: { customer_id: string; title: string; description?: string; priority: string }) =>
      crmApi.createCase(input, ctx),
  });

  useEffect(() => {
    if (!open) {
      setForm(EMPTY_FORM);
      setErrors({});
      setApiError('');
    }
  }, [open]);

  if (!open) return null;

  function handleClose() {
    setForm(EMPTY_FORM);
    setErrors({});
    setApiError('');
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError('');

    const validationErrors = validate(form);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    try {
      const payload: { customer_id: string; title: string; description?: string; priority: string } = {
        customer_id: form.customer_id,
        title: form.title.trim(),
        priority: form.priority,
      };
      if (form.description.trim()) payload.description = form.description.trim();

      await mutation.mutateAsync(payload);
      setForm(EMPTY_FORM);
      setErrors({});
      onSuccess();
      onClose();
    } catch {
      setApiError('Failed to create case. Please try again.');
    }
  }

  const customers = customersData?.data ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New Case"
        className="w-full max-w-md rounded-lg bg-card shadow-xl border border-border"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold">New Case</h2>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="space-y-4 px-6 py-5">
            <div>
              <label htmlFor="case-customer" className="mb-1.5 block text-sm font-medium">
                Customer <span className="text-red-500">*</span>
              </label>
              <select
                id="case-customer"
                aria-label="Customer"
                value={form.customer_id}
                onChange={(e) => {
                  setForm((prev) => ({ ...prev, customer_id: e.target.value }));
                  if (errors.customer_id) setErrors((prev) => ({ ...prev, customer_id: undefined }));
                }}
                disabled={loadingCustomers}
                className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                  errors.customer_id ? 'border-red-500' : 'border-border'
                }`}
              >
                <option value="">Select a customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {errors.customer_id && (
                <p className="mt-1 text-xs text-red-500">{errors.customer_id}</p>
              )}
              {customersError && (
                <p className="mt-1 text-xs text-red-500">Failed to load customers</p>
              )}
            </div>

            <div>
              <label htmlFor="case-title" className="mb-1.5 block text-sm font-medium">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                id="case-title"
                aria-label="Title"
                type="text"
                required
                value={form.title}
                onChange={(e) => {
                  setForm((prev) => ({ ...prev, title: e.target.value }));
                  if (errors.title) setErrors((prev) => ({ ...prev, title: undefined }));
                }}
                placeholder="Brief description of the issue"
                className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                  errors.title ? 'border-red-500' : 'border-border'
                }`}
              />
              {errors.title && (
                <p className="mt-1 text-xs text-red-500">{errors.title}</p>
              )}
            </div>

            <div>
              <label htmlFor="case-description" className="mb-1.5 block text-sm font-medium">
                Description
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">(optional)</span>
              </label>
              <textarea
                id="case-description"
                aria-label="Description"
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Additional details…"
                rows={3}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
            </div>

            <div>
              <p className="mb-1.5 text-sm font-medium">Priority</p>
              <div className="flex gap-2">
                {PRIORITIES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={form.priority === p}
                    onClick={() => setForm((prev) => ({ ...prev, priority: p }))}
                    className={`flex-1 rounded-md border px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                      form.priority === p
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {apiError && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{apiError}</p>
            )}
          </div>

          <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {mutation.isPending ? 'Creating…' : 'Create Case'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
