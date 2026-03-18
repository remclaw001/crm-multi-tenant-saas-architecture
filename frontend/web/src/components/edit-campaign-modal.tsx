'use client';

import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi, ApiError } from '@/lib/api-client';
import type { Campaign } from '@/types/api.types';

interface Props {
  campaign: Campaign | null; // null = closed
  onClose: () => void;
  onSuccess: () => void;
}

interface FormState {
  name: string;
  status: 'draft' | 'active' | 'paused' | 'completed';
  target_count: string; // string for controlled input; converted to number on submit
  scheduled_at: string; // datetime-local string
}

interface FormErrors {
  name?: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  status: 'draft',
  target_count: '',
  scheduled_at: '',
};

export function EditCampaignModal({ campaign, onClose, onSuccess }: Props) {
  const { token, tenantId } = useAuthStore();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [apiError, setApiError] = useState('');

  // Re-initialize form whenever a different campaign is opened; reset when closed
  useEffect(() => {
    if (campaign) {
      setForm({
        name: campaign.name,
        status: campaign.status,
        // target_count === 0 is the backend default (not a meaningful user value) → show empty
        target_count: campaign.target_count > 0 ? String(campaign.target_count) : '',
        // Slice UTC ISO to YYYY-MM-DDTHH:mm for datetime-local input (same pattern as AddCampaignModal)
        scheduled_at: campaign.scheduled_at ? campaign.scheduled_at.slice(0, 16) : '',
      });
      setErrors({});
      setApiError('');
    } else {
      setForm(EMPTY_FORM);
      setErrors({});
      setApiError('');
    }
  }, [campaign]);

  const mutation = useMutation({
    mutationFn: (input: {
      name: string;
      status: 'draft' | 'active' | 'paused' | 'completed';
      target_count?: number;
      scheduled_at: string | null;
    }) =>
      crmApi.updateCampaign(campaign!.id, input, {
        token: token ?? '',
        tenantId: tenantId ?? '',
      }),
  });

  // All hooks declared above — safe to return null now
  if (!campaign) return null;

  function handleClose() {
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
        status: form.status,
        target_count: form.target_count ? Number(form.target_count) : undefined,
        scheduled_at: form.scheduled_at || null,
      });
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
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit Campaign"
        className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold">Edit Campaign</h2>
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
              <label htmlFor="edit-campaign-name" className="mb-1.5 block text-sm font-medium">
                Campaign Name <span className="text-red-500">*</span>
              </label>
              <input
                id="edit-campaign-name"
                aria-label="Campaign Name"
                type="text"
                value={form.name}
                onChange={(e) => {
                  setForm((prev) => ({ ...prev, name: e.target.value }));
                  if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }));
                }}
                className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                  errors.name ? 'border-red-500' : 'border-border'
                }`}
              />
              {errors.name && (
                <p className="mt-1 text-xs text-red-500">{errors.name}</p>
              )}
            </div>

            {/* Status */}
            <div>
              <label htmlFor="edit-campaign-status" className="mb-1.5 block text-sm font-medium">
                Status
              </label>
              <select
                id="edit-campaign-status"
                aria-label="Status"
                value={form.status}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  setForm((prev) => ({
                    ...prev,
                    status: e.target.value as FormState['status'],
                  }))
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
              </select>
            </div>

            {/* Target Count */}
            <div>
              <label htmlFor="edit-campaign-target" className="mb-1.5 block text-sm font-medium">
                Target Count{' '}
                <span className="text-xs font-normal text-muted-foreground">(optional)</span>
              </label>
              <input
                id="edit-campaign-target"
                aria-label="Target Count"
                type="number"
                min="1"
                value={form.target_count}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, target_count: e.target.value }))
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Schedule Date */}
            <div>
              <label htmlFor="edit-campaign-schedule" className="mb-1.5 block text-sm font-medium">
                Schedule Date{' '}
                <span className="text-xs font-normal text-muted-foreground">(optional)</span>
              </label>
              <input
                id="edit-campaign-schedule"
                aria-label="Schedule Date"
                type="datetime-local"
                value={form.scheduled_at}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, scheduled_at: e.target.value }))
                }
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
              {mutation.isPending ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
