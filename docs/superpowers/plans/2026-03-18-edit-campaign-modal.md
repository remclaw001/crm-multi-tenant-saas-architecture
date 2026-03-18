# Edit Campaign Modal Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users edit existing campaigns by clicking a card, opening a pre-filled modal that saves via `PUT /api/v1/plugins/marketing/campaigns/:id`.

**Architecture:** `updateCampaign` is added to the API client; `CampaignsList` gets an `onEdit` callback; a new `EditCampaignModal` handles form state and mutation; `marketing/page.tsx` tracks `editTarget: Campaign | null` to drive the modal.

**Tech Stack:** Next.js 15, React 19, TanStack Query v5 (`useMutation`), Vitest + Testing Library, Tailwind CSS, TypeScript.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `frontend/web/src/lib/api-client.ts` | Modify | Add `updateCampaign(id, input, ctx)` method |
| `frontend/web/src/components/campaigns-list.tsx` | Modify | Add required `onEdit` prop; make cards clickable |
| `frontend/web/src/components/edit-campaign-modal.tsx` | Create | Edit form: name, status, target_count, scheduled_at |
| `frontend/web/src/app/(plugins)/marketing/page.tsx` | Modify | `editTarget` state; wire `CampaignsList` + modal |
| `frontend/web/src/components/__tests__/edit-campaign-modal.test.tsx` | Create | 10 tests covering all modal behaviours |

---

## Task 1: Add `updateCampaign` to `api-client.ts`

**Files:**
- Modify: `frontend/web/src/lib/api-client.ts`

No separate unit test — the method is exercised by the modal's mutation tests.

- [ ] **Step 1: Add `updateCampaign` after `createCampaign`**

In `frontend/web/src/lib/api-client.ts`, after the `createCampaign` method (around line 253), add:

```ts
  updateCampaign(
    id: string,
    input: {
      name?: string;
      status?: 'draft' | 'active' | 'paused' | 'completed';
      target_count?: number;
      scheduled_at?: string | null;
    },
    ctx: AuthCtx,
  ): Promise<PluginItemResponse<Campaign>> {
    return request(`/api/v1/plugins/marketing/campaigns/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
      ...ctx,
    });
  },
```

- [ ] **Step 2: Commit**

```bash
git add frontend/web/src/lib/api-client.ts
git commit -m "feat(marketing): add updateCampaign to api-client"
```

---

## Task 2: Write failing tests for `EditCampaignModal`

**Files:**
- Create: `frontend/web/src/components/__tests__/edit-campaign-modal.test.tsx`

Write all tests before implementing the component — they will all fail at first.

- [ ] **Step 1: Create the test file**

Create `frontend/web/src/components/__tests__/edit-campaign-modal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EditCampaignModal } from '../edit-campaign-modal';
import type { Campaign } from '@/types/api.types';

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
    crmApi: { updateCampaign: vi.fn() },
    ApiError: MockApiError,
  };
});

// ── Fixture ────────────────────────────────────────────────────────────────
const mockCampaign: Campaign = {
  id: 'camp-1',
  tenant_id: 'tid',
  name: 'Summer Sale',
  status: 'draft',
  campaign_type: 'email',
  target_count: 500,
  sent_count: 0,
  scheduled_at: '2026-06-15T10:00:00.000Z',
  created_at: '2026-03-01T00:00:00.000Z',
  updated_at: '2026-03-01T00:00:00.000Z',
};

const defaultProps = {
  campaign: mockCampaign,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

// ── Tests ──────────────────────────────────────────────────────────────────
describe('EditCampaignModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when campaign is null', () => {
    render(<EditCampaignModal campaign={null} onClose={vi.fn()} onSuccess={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders all 4 fields pre-filled with campaign values', () => {
    render(<EditCampaignModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/campaign name/i)).toHaveValue('Summer Sale');
    expect(screen.getByLabelText(/^status$/i)).toHaveValue('draft');
    expect(screen.getByLabelText(/target count/i)).toHaveValue(500);
    expect(screen.getByLabelText(/schedule date/i)).toHaveValue('2026-06-15T10:00');
  });

  it('shows validation error when submitting with empty name', async () => {
    render(<EditCampaignModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/campaign name/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('calls updateCampaign with correct payload on valid submit', async () => {
    mockMutateAsync.mockResolvedValue({});
    render(<EditCampaignModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        name: 'Summer Sale',
        status: 'draft',
        target_count: 500,
        scheduled_at: '2026-06-15T10:00',
      }),
    );
  });

  it('calls onSuccess and onClose after successful mutation', async () => {
    mockMutateAsync.mockResolvedValue({});
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<EditCampaignModal campaign={mockCampaign} onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows API error message when mutateAsync rejects with ApiError', async () => {
    const { ApiError } = await import('@/lib/api-client');
    mockMutateAsync.mockRejectedValue(new (ApiError as any)(422, { detail: 'Name too long' }));
    render(<EditCampaignModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText(/name too long/i)).toBeInTheDocument();
  });

  it('shows generic error when mutateAsync rejects with unknown error', async () => {
    mockMutateAsync.mockRejectedValue(new Error('network failure'));
    render(<EditCampaignModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText(/failed to save/i)).toBeInTheDocument();
  });

  it('clicking the backdrop calls onClose', () => {
    const onClose = vi.fn();
    const { container } = render(
      <EditCampaignModal campaign={mockCampaign} onClose={onClose} onSuccess={vi.fn()} />,
    );
    const backdrop = container.firstChild as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('form re-initializes when campaign prop changes', () => {
    const other: Campaign = { ...mockCampaign, id: 'camp-2', name: 'Winter Promo' };
    const { rerender } = render(<EditCampaignModal {...defaultProps} />);
    rerender(<EditCampaignModal campaign={other} onClose={vi.fn()} onSuccess={vi.fn()} />);
    expect(screen.getByLabelText(/campaign name/i)).toHaveValue('Winter Promo');
  });

  it('target_count shows empty string when campaign target_count is 0', () => {
    render(
      <EditCampaignModal
        campaign={{ ...mockCampaign, target_count: 0 }}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/target count/i)).toHaveValue(null);
  });
});
```

- [ ] **Step 2: Run tests to confirm they all fail**

```bash
cd frontend/web && npx vitest run src/components/__tests__/edit-campaign-modal.test.tsx
```

Expected: all 10 tests FAIL with "Cannot find module '../edit-campaign-modal'" or similar.

- [ ] **Step 3: Commit failing tests**

```bash
git add frontend/web/src/components/__tests__/edit-campaign-modal.test.tsx
git commit -m "test(marketing): add failing tests for EditCampaignModal"
```

---

## Task 3: Implement `EditCampaignModal`

**Files:**
- Create: `frontend/web/src/components/edit-campaign-modal.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/web/src/components/edit-campaign-modal.tsx`:

```tsx
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
```

- [ ] **Step 2: Run all tests and confirm they pass**

```bash
cd frontend/web && npx vitest run src/components/__tests__/edit-campaign-modal.test.tsx
```

Expected: all 10 tests PASS.

If any test fails, fix the component — do not change the tests.

- [ ] **Step 3: Commit**

```bash
git add frontend/web/src/components/edit-campaign-modal.tsx
git commit -m "feat(marketing): implement EditCampaignModal component"
```

---

## Task 4: Update `CampaignsList` to support clicking

**Files:**
- Modify: `frontend/web/src/components/campaigns-list.tsx`

- [ ] **Step 1: Add `onEdit` prop and click handler**

In `frontend/web/src/components/campaigns-list.tsx`, change the function signature and each card div:

```tsx
export function CampaignsList({
  campaigns,
  onEdit,
}: {
  campaigns: Campaign[];
  onEdit: (campaign: Campaign) => void;
}) {
```

Change the card `<div>` (currently `<div key={c.id} className="rounded-lg border border-border bg-card p-4">`) to:

```tsx
<div
  key={c.id}
  className="cursor-pointer rounded-lg border border-border bg-card p-4 hover:bg-accent/50"
  onClick={() => onEdit(c)}
>
```

- [ ] **Step 2: Run the full test suite to check for regressions**

```bash
cd frontend/web && npx vitest run
```

Expected: all tests pass. If any `CampaignsList` tests fail (none currently exist), fix accordingly.

- [ ] **Step 3: Commit**

```bash
git add frontend/web/src/components/campaigns-list.tsx
git commit -m "feat(marketing): make campaign cards clickable for editing"
```

---

## Task 5: Wire up `marketing/page.tsx`

**Files:**
- Modify: `frontend/web/src/app/(plugins)/marketing/page.tsx`

- [ ] **Step 1: Add `editTarget` state, wire `CampaignsList`, mount modal**

In `frontend/web/src/app/(plugins)/marketing/page.tsx`:

1. Add `EditCampaignModal` import after `AddCampaignModal`:
```tsx
import { EditCampaignModal } from '@/components/edit-campaign-modal';
```

2. Add `editTarget` state after `modalOpen`:
```tsx
const [editTarget, setEditTarget] = useState<Campaign | null>(null);
```

3. Add `onEdit` prop to `<CampaignsList>`:
```tsx
<CampaignsList campaigns={filtered} onEdit={(c) => setEditTarget(c)} />
```

4. Mount `<EditCampaignModal>` after `<AddCampaignModal>`:
```tsx
<EditCampaignModal
  campaign={editTarget}
  onClose={() => setEditTarget(null)}
  onSuccess={handleSuccess}
/>
```

- [ ] **Step 2: Run the full test suite**

```bash
cd frontend/web && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/web/src/app/(plugins)/marketing/page.tsx
git commit -m "feat(marketing): wire EditCampaignModal into marketing page"
```

---

## Final Verification

- [ ] **Run the full test suite one last time**

```bash
cd frontend/web && npx vitest run
```

Expected: all tests pass, no regressions.
