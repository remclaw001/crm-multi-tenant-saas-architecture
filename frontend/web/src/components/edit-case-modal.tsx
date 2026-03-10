'use client';

import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import type { SupportCase } from '@/types/api.types';

interface Props {
  supportCase: SupportCase;
  onClose: () => void;
  onSuccess: () => void;
}

interface FormState {
  title: string;
  description: string;
  status: SupportCase['status'];
  priority: SupportCase['priority'];
  assigned_to: string; // empty string = null (Unassigned)
}

function caseToForm(c: SupportCase): FormState {
  return {
    title: c.title,
    description: c.description ?? '',
    status: c.status,
    priority: c.priority,
    assigned_to: c.assigned_to ?? '',
  };
}

const STATUSES: { value: SupportCase['status']; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

const PRIORITIES: SupportCase['priority'][] = ['low', 'medium', 'high'];

export function EditCaseModal({ supportCase, onClose, onSuccess }: Props) {
  const { token, tenantId } = useAuthStore();
  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const [form, setForm] = useState<FormState>(() => caseToForm(supportCase));
  const [titleError, setTitleError] = useState('');
  const [apiError, setApiError] = useState('');

  // Reset form when a different case is opened (skip initial mount)
  const prevIdRef = useRef(supportCase.id);
  useEffect(() => {
    if (prevIdRef.current !== supportCase.id) {
      prevIdRef.current = supportCase.id;
      setForm(caseToForm(supportCase));
      setTitleError('');
      setApiError('');
    }
  }, [supportCase.id]);

  const { data: users = [], isLoading: loadingUsers, isError: usersError } = useQuery({
    queryKey: ['users', tenantId],
    queryFn: () => crmApi.getUsers(ctx),
    enabled: Boolean(token && tenantId),
  });

  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof crmApi.updateCase>[1]) =>
      crmApi.updateCase(supportCase.id, input, ctx),
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError('');

    if (!form.title.trim()) {
      setTitleError('Title is required');
      return;
    }
    setTitleError('');

    try {
      await mutation.mutateAsync({
        title: form.title.trim(),
        description: form.description || null,
        status: form.status,
        priority: form.priority,
        assigned_to: form.assigned_to || null,
      });
      onSuccess();
      onClose();
    } catch {
      setApiError('Failed to save. Please try again.');
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
        aria-label="Edit Case"
        className="w-full max-w-md rounded-lg bg-card shadow-xl border border-border"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold">Edit Case</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="space-y-4 px-6 py-5">
            {/* Title */}
            <div>
              <label htmlFor="edit-case-title" className="mb-1.5 block text-sm font-medium">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                id="edit-case-title"
                aria-label="Title"
                type="text"
                required
                value={form.title}
                onChange={(e) => {
                  setForm((prev) => ({ ...prev, title: e.target.value }));
                  if (titleError) setTitleError('');
                }}
                className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                  titleError ? 'border-red-500' : 'border-border'
                }`}
              />
              {titleError && <p className="mt-1 text-xs text-red-500">{titleError}</p>}
            </div>

            {/* Description */}
            <div>
              <label htmlFor="edit-case-description" className="mb-1.5 block text-sm font-medium">
                Description
              </label>
              <textarea
                id="edit-case-description"
                aria-label="Description"
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                rows={3}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Status */}
            <div>
              <label htmlFor="edit-case-status" className="mb-1.5 block text-sm font-medium">
                Status
              </label>
              <select
                id="edit-case-status"
                aria-label="Status"
                value={form.status}
                onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value as SupportCase['status'] }))}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            {/* Priority */}
            <div>
              <p className="mb-1.5 text-sm font-medium">Priority</p>
              <div className="flex gap-2">
                {PRIORITIES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={form.priority === p}
                    onClick={() => setForm((prev) => ({ ...prev, priority: p }))}
                    className={`rounded-md border px-4 py-1.5 text-sm capitalize ${
                      form.priority === p
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background hover:bg-accent'
                    }`}
                  >
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Assigned To */}
            <div>
              <label htmlFor="edit-case-assigned-to" className="mb-1.5 block text-sm font-medium">
                Assigned To
              </label>
              <select
                id="edit-case-assigned-to"
                aria-label="Assigned To"
                value={form.assigned_to}
                onChange={(e) => setForm((prev) => ({ ...prev, assigned_to: e.target.value }))}
                disabled={loadingUsers || usersError}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              >
                {loadingUsers ? (
                  <option value="">Loading users…</option>
                ) : usersError ? (
                  <option value="">Failed to load users</option>
                ) : (
                  <>
                    <option value="">Unassigned</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </>
                )}
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
