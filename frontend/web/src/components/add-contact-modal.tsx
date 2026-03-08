'use client';

import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface FormState {
  name: string;
  email: string;
  phone: string;
  company: string;
}

interface FormErrors {
  name?: string;
  email?: string;
}

const EMPTY_FORM: FormState = { name: '', email: '', phone: '', company: '' };

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!form.name.trim()) {
    errors.name = 'Name is required';
  }
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errors.email = 'Please enter a valid email';
  }
  return errors;
}

export function AddContactModal({ open, onClose, onSuccess }: Props) {
  const { token, tenantId } = useAuthStore();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [apiError, setApiError] = useState('');

  useEffect(() => {
    if (!open) {
      setForm(EMPTY_FORM);
      setErrors({});
      setApiError('');
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: (input: { name: string; email?: string; phone?: string; company?: string }) =>
      crmApi.createCustomer(input, { token: token ?? '', tenantId: tenantId ?? '' }),
  });

  if (!open) return null;

  function handleChange(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
      if (errors[field as keyof FormErrors]) {
        setErrors((prev) => ({ ...prev, [field]: undefined }));
      }
    };
  }

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
      const payload: { name: string; email?: string; phone?: string; company?: string } = { name: form.name.trim() };
      if (form.email) payload.email = form.email;
      if (form.phone) payload.phone = form.phone;
      if (form.company) payload.company = form.company;

      await mutation.mutateAsync(payload);
      setForm(EMPTY_FORM);
      setErrors({});
      onSuccess();
      onClose();
    } catch {
      setApiError('Failed to save. Please try again.');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add Contact"
        className="w-full max-w-md rounded-lg bg-card shadow-xl border border-border"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold">Add Contact</h2>
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
              <label htmlFor="contact-name" className="mb-1.5 block text-sm font-medium">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                id="contact-name"
                aria-label="Name"
                type="text"
                value={form.name}
                onChange={handleChange('name')}
                placeholder="Full name"
                className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                  errors.name ? 'border-red-500' : 'border-border'
                }`}
              />
              {errors.name && (
                <p className="mt-1 text-xs text-red-500">{errors.name}</p>
              )}
            </div>

            {/* Email */}
            <div>
              <label htmlFor="contact-email" className="mb-1.5 block text-sm font-medium">
                Email
              </label>
              <input
                id="contact-email"
                aria-label="Email"
                type="email"
                value={form.email}
                onChange={handleChange('email')}
                placeholder="email@example.com"
                className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                  errors.email ? 'border-red-500' : 'border-border'
                }`}
              />
              {errors.email && (
                <p className="mt-1 text-xs text-red-500">{errors.email}</p>
              )}
            </div>

            {/* Phone */}
            <div>
              <label htmlFor="contact-phone" className="mb-1.5 block text-sm font-medium">
                Phone
              </label>
              <input
                id="contact-phone"
                aria-label="Phone"
                type="tel"
                value={form.phone}
                onChange={handleChange('phone')}
                placeholder="Phone number"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Company */}
            <div>
              <label htmlFor="contact-company" className="mb-1.5 block text-sm font-medium">
                Company
              </label>
              <input
                id="contact-company"
                aria-label="Company"
                type="text"
                value={form.company}
                onChange={handleChange('company')}
                placeholder="Company name"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* API Error */}
            {apiError && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
                {apiError}
              </p>
            )}
          </div>

          {/* Footer */}
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
              {mutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
