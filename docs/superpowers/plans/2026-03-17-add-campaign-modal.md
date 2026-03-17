# Add Campaign Modal Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Add Campaign" button and modal to the Marketing page so users can create campaigns from the UI.

**Architecture:** A new `AddCampaignModal` component follows the exact `add-contact-modal` pattern — `open/onClose/onSuccess` props, `useMutation`, inline form state, `useEffect` reset. The marketing page gains a `useQueryClient` hook, an `Add Campaign` button in the header (next to the existing status filter), and mounts the modal.

**Tech Stack:** React 19, Next.js 15, TanStack Query v5 (`useMutation`), Zustand (`useAuthStore`), Tailwind CSS, Vitest + Testing Library (TDD).

---

## File Map

| File | Status | Change |
|---|---|---|
| `frontend/web/src/components/add-campaign-modal.tsx` | **Create** | New modal component |
| `frontend/web/src/components/__tests__/add-campaign-modal.test.tsx` | **Create** | 7 unit tests |
| `frontend/web/src/app/(plugins)/marketing/page.tsx` | **Modify** | Add button, `useQueryClient`, mount modal |

All commands run from `frontend/web/`.

---

## Chunk 1: AddCampaignModal + marketing page update

### Task 1: Create `AddCampaignModal` — TDD

**Files:**
- Create: `src/components/__tests__/add-campaign-modal.test.tsx`
- Create: `src/components/add-campaign-modal.tsx`

---

- [ ] **Step 1: Write the failing tests**

Create `src/components/__tests__/add-campaign-modal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddCampaignModal } from '../add-campaign-modal';

// ── Hoisted mocks ──────────────────────────────────────────────────────────
const mockMutateAsync = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(() => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  })),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(() => ({ token: 'tok', tenantId: 'tid' })),
}));

// Export ApiError from the mock so instanceof checks inside the component work
vi.mock('@/lib/api-client', () => {
  class MockApiError extends Error {
    status: number;
    body: { detail?: string; title?: string };
    constructor(status: number, body: { detail?: string; title?: string }) {
      super('ApiError');
      this.status = status;
      this.body = body;
    }
  }
  return {
    crmApi: { createCampaign: vi.fn() },
    ApiError: MockApiError,
  };
});

// ── Helpers ────────────────────────────────────────────────────────────────
const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

// ── Tests ──────────────────────────────────────────────────────────────────
describe('AddCampaignModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when open=false', () => {
    render(<AddCampaignModal {...defaultProps} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders dialog with all fields when open=true', () => {
    render(<AddCampaignModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/campaign name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^type$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/schedule date/i)).toBeInTheDocument();
  });

  it('type select defaults to "email"', () => {
    render(<AddCampaignModal {...defaultProps} />);
    expect(screen.getByLabelText(/^type$/i)).toHaveValue('email');
  });

  it('shows validation error when submitting with empty name', async () => {
    render(<AddCampaignModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /create campaign/i }));
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('calls createCampaign with correct payload on valid submit', async () => {
    mockMutateAsync.mockResolvedValue({});
    render(<AddCampaignModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/campaign name/i), { target: { value: 'Test Campaign' } });
    fireEvent.click(screen.getByRole('button', { name: /create campaign/i }));
    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        name: 'Test Campaign',
        campaign_type: 'email',
        scheduled_at: undefined,
      }),
    );
  });

  it('calls onSuccess and onClose after successful mutation', async () => {
    mockMutateAsync.mockResolvedValue({});
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<AddCampaignModal open={true} onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText(/campaign name/i), { target: { value: 'Test Campaign' } });
    fireEvent.click(screen.getByRole('button', { name: /create campaign/i }));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows API error message when mutateAsync rejects with ApiError', async () => {
    const { ApiError } = await import('@/lib/api-client');
    mockMutateAsync.mockRejectedValue(new (ApiError as any)(500, { detail: 'Something went wrong' }));
    render(<AddCampaignModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/campaign name/i), { target: { value: 'Test' } });
    fireEvent.click(screen.getByRole('button', { name: /create campaign/i }));
    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
  });

  it('resets form when modal closes (open → false)', () => {
    const { rerender } = render(<AddCampaignModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/campaign name/i), { target: { value: 'My Campaign' } });
    rerender(<AddCampaignModal {...defaultProps} open={false} />);
    rerender(<AddCampaignModal {...defaultProps} open={true} />);
    expect(screen.getByLabelText(/campaign name/i)).toHaveValue('');
  });
});
```

---

- [ ] **Step 2: Run failing tests**

```bash
npx vitest run src/components/__tests__/add-campaign-modal.test.tsx
```

Expected: all 7 tests FAIL (`AddCampaignModal` does not exist yet).

---

- [ ] **Step 3: Create `add-campaign-modal.tsx`**

Create `src/components/add-campaign-modal.tsx`:

```tsx
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
```

---

- [ ] **Step 4: Run tests — confirm all 7 pass**

```bash
npx vitest run src/components/__tests__/add-campaign-modal.test.tsx
```

Expected: `Tests  7 passed (7)`.

---

- [ ] **Step 5: Commit**

```bash
git add src/components/add-campaign-modal.tsx \
        src/components/__tests__/add-campaign-modal.test.tsx
git commit -m "feat(marketing): add AddCampaignModal component"
```

---

### Task 2: Update `marketing/page.tsx`

**Files:**
- Modify: `src/app/(plugins)/marketing/page.tsx`

No new tests needed — the page change is wiring (button click opens modal; invalidation is trivially covered by the fact the component mounts and the query key matches).

---

- [ ] **Step 1: Replace `marketing/page.tsx`**

Replace the entire file with:

```tsx
'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import { CampaignsList } from '@/components/campaigns-list';
import { AddCampaignModal } from '@/components/add-campaign-modal';
import { PluginGate } from '@/components/plugin-gate';
import type { Campaign } from '@/types/api.types';

const STATUSES: { value: Campaign['status'] | ''; label: string }[] = [
  { value: '',          label: 'All statuses' },
  { value: 'draft',     label: 'Draft'        },
  { value: 'active',    label: 'Active'       },
  { value: 'paused',    label: 'Paused'       },
  { value: 'completed', label: 'Completed'    },
];

export default function MarketingPage() {
  const { token, tenantId } = useAuthStore();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [modalOpen, setModalOpen] = useState(false);
  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['campaigns', tenantId],
    queryFn: () => crmApi.getCampaigns(ctx),
    enabled: Boolean(token && tenantId),
  });

  const filtered = statusFilter
    ? (data?.data ?? []).filter((c) => c.status === statusFilter)
    : (data?.data ?? []);

  function handleSuccess() {
    queryClient.invalidateQueries({ queryKey: ['campaigns', tenantId] });
  }

  return (
    <PluginGate plugin="marketing" pluginLabel="Marketing">
      <div>
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold">Marketing</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {data ? `${data.count} campaigns` : 'Manage marketing campaigns'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              Add Campaign
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            Loading…
          </div>
        ) : isError ? (
          <div className="flex h-64 items-center justify-center text-red-600">
            Failed to load campaigns.
          </div>
        ) : (
          <CampaignsList campaigns={filtered} />
        )}

        <AddCampaignModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSuccess={handleSuccess}
        />
      </div>
    </PluginGate>
  );
}
```

---

- [ ] **Step 2: Run full frontend test suite**

```bash
npm test
```

Expected: all previously passing tests still pass. The 1 pre-existing failure in `add-contact-modal.test.tsx` (`shows API error message when mutateAsync throws`) is a known issue that pre-dates this feature — do not fix it here.

---

- [ ] **Step 3: Commit**

```bash
git add "src/app/(plugins)/marketing/page.tsx"
git commit -m "feat(marketing): add Add Campaign button and wire modal to page"
```
