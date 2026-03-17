'use client';

import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi, ApiError } from '@/lib/api-client';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface FormState {
  name: string;
  campaign_type: 'email' | 'sms';
  scheduled_at: string;
}

interface FormErrors {
  name?: string;
}

const EMPTY_FORM: FormState = { name: '', campaign_type: 'email', scheduled_at: '' };

export function AddCampaignModal({ open, onClose, onSuccess }: Props) {
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
    mutationFn: (input: { name: string; campaign_type: 'email' | 'sms'; scheduled_at?: string }) =>
      crmApi.createCampaign(input, { token: token ?? '', tenantId: tenantId ?? '' }),
  });

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

    if (!form.name.trim()) {
      setErrors({ name: 'Name is required' });
      return;
    }

    try {
      await mutation.mutateAsync({
        name: form.name.trim(),
        campaign_type: form.campaign_type,
        scheduled_at: form.scheduled_at || undefined,
      });
      setForm(EMPTY_FORM);
      setErrors({});
      onSuccess();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setApiError(err.body.detail ?? err.body.title ?? `Server error (${err.status})`);
      } else {
        setApiError('Failed to save. Please try again.');
      }
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
        aria-label="Add Campaign"
        className="w-full max-w-md rounded-lg bg-card shadow-xl border border-border"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold">Add Campaign</h2>
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
            {/* Campaign Name */}
            <div>
              <label htmlFor="campaign-name" className="mb-1.5 block text-sm font-medium">
                Campaign Name <span className="text-red-500">*</span>
              </label>
              <input
                id="campaign-name"
                aria-label="Campaign Name"
                type="text"
                value={form.name}
                onChange={(e) => {
                  setForm((prev) => ({ ...prev, name: e.target.value }));
                  if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }));
                }}
                placeholder="e.g. Summer Sale 2026"
                className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                  errors.name ? 'border-red-500' : 'border-border'
                }`}
              />
              {errors.name && (
                <p className="mt-1 text-xs text-red-500">{errors.name}</p>
              )}
            </div>

            {/* Type */}
            <div>
              <label htmlFor="campaign-type" className="mb-1.5 block text-sm font-medium">
                Type
              </label>
              <select
                id="campaign-type"
                aria-label="Type"
                value={form.campaign_type}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  setForm((prev) => ({ ...prev, campaign_type: e.target.value as 'email' | 'sms' }))
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
            </div>

            {/* Schedule Date */}
            <div>
              <label htmlFor="campaign-schedule" className="mb-1.5 block text-sm font-medium">
                Schedule Date{' '}
                <span className="text-xs font-normal text-muted-foreground">(optional)</span>
              </label>
              <input
                id="campaign-schedule"
                aria-label="Schedule Date"
                type="datetime-local"
                value={form.scheduled_at}
                onChange={(e) => setForm((prev) => ({ ...prev, scheduled_at: e.target.value }))}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
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
              className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {mutation.isPending ? 'Saving…' : 'Create Campaign'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
