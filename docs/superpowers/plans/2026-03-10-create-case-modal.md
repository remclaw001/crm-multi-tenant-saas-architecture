# Create Case Modal — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "New Case" modal to the Cases page so users can create a support case from the frontend.

**Architecture:** New `CreateCaseModal` component (follows the same pattern as `AddContactModal`) fetches the customer list for a dropdown and submits via `crmApi.createCase`. The Cases page wires up the modal with `useState` + `onSuccess` callback that invalidates the cases query.

**Tech Stack:** Next.js 15, React 19, TanStack Query v5, Vitest + Testing Library, Tailwind CSS, Lucide icons.

---

## Chunk 1: CreateCaseModal component + tests

### Task 1: Write failing tests for `CreateCaseModal`

**Files:**
- Create: `frontend/web/src/components/__tests__/create-case-modal.test.tsx`

**Reference:** Study `frontend/web/src/components/__tests__/add-contact-modal.test.tsx` for the mock setup pattern. The key gotcha: variables inside `vi.mock()` factory functions must be declared with `vi.hoisted()`.

- [ ] **Step 1: Create the test file**

```tsx
// frontend/web/src/components/__tests__/create-case-modal.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateCaseModal } from '../create-case-modal';

const mockMutateAsync = vi.hoisted(() => vi.fn());
const mockInvalidateQueries = vi.hoisted(() => vi.fn());
const mockCustomers = vi.hoisted(() => [
  { id: 'c1', name: 'Acme Corp', tenant_id: 'tid', email: null, phone: null, company: null, is_active: true, created_at: '', updated_at: '' },
  { id: 'c2', name: 'Beta Ltd',  tenant_id: 'tid', email: null, phone: null, company: null, is_active: true, created_at: '', updated_at: '' },
]);

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(() => ({ mutateAsync: mockMutateAsync, isPending: false })),
  useQuery: vi.fn(() => ({ data: { data: mockCustomers }, isLoading: false })),
  useQueryClient: vi.fn(() => ({ invalidateQueries: mockInvalidateQueries })),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(() => ({ token: 'tok', tenantId: 'tid' })),
}));

vi.mock('@/lib/api-client', () => ({
  crmApi: { getCustomers: vi.fn(), createCase: vi.fn() },
}));

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

describe('CreateCaseModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when open=false', () => {
    render(<CreateCaseModal {...defaultProps} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders dialog with all fields when open=true', () => {
    render(<CreateCaseModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/customer/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /low/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /medium/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /high/i })).toBeInTheDocument();
  });

  it('shows customer options from getCustomers', () => {
    render(<CreateCaseModal {...defaultProps} />);
    expect(screen.getByRole('option', { name: /acme corp/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /beta ltd/i })).toBeInTheDocument();
  });

  it('shows error when submitting with empty title', async () => {
    render(<CreateCaseModal {...defaultProps} />);
    // Select a customer first
    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: 'c1' } });
    fireEvent.click(screen.getByRole('button', { name: /create case/i }));
    expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('shows error when submitting without selecting a customer', async () => {
    render(<CreateCaseModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Login bug' } });
    fireEvent.click(screen.getByRole('button', { name: /create case/i }));
    expect(await screen.findByText(/customer is required/i)).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('calls mutateAsync with correct payload on valid submit', async () => {
    mockMutateAsync.mockResolvedValue({});
    render(<CreateCaseModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: 'c1' } });
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Login bug' } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Details here' } });
    fireEvent.click(screen.getByRole('button', { name: /create case/i }));
    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        customer_id: 'c1',
        title: 'Login bug',
        description: 'Details here',
        priority: 'medium',
      }),
    );
  });

  it('calls onSuccess and onClose after successful submit', async () => {
    mockMutateAsync.mockResolvedValue({});
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<CreateCaseModal open={true} onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: 'c1' } });
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Login bug' } });
    fireEvent.click(screen.getByRole('button', { name: /create case/i }));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows API error when mutateAsync throws', async () => {
    mockMutateAsync.mockRejectedValue(new Error('Server error'));
    render(<CreateCaseModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: 'c1' } });
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Login bug' } });
    fireEvent.click(screen.getByRole('button', { name: /create case/i }));
    expect(await screen.findByText(/failed to create case/i)).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(<CreateCaseModal open={true} onClose={onClose} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('priority defaults to medium and can be changed', () => {
    render(<CreateCaseModal {...defaultProps} />);
    // Medium should look selected by default (aria-pressed=true)
    expect(screen.getByRole('button', { name: /medium/i })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /high/i }));
    expect(screen.getByRole('button', { name: /high/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /medium/i })).toHaveAttribute('aria-pressed', 'false');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd frontend/web && npx vitest run src/components/__tests__/create-case-modal.test.tsx
```

Expected: FAIL — `Cannot find module '../create-case-modal'`

---

### Task 2: Implement `CreateCaseModal`

**Files:**
- Create: `frontend/web/src/components/create-case-modal.tsx`

**Reference:** Model after `frontend/web/src/components/add-contact-modal.tsx`. Key differences: needs `useQuery` for customers, priority is a button-toggle group (not a `<select>`), customer is a `<select>` driven by the query result.

- [ ] **Step 3: Create the component**

```tsx
// frontend/web/src/components/create-case-modal.tsx
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

  const { data: customersData, isLoading: loadingCustomers } = useQuery({
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
        {/* Header */}
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

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate>
          <div className="space-y-4 px-6 py-5">

            {/* Customer */}
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
            </div>

            {/* Title */}
            <div>
              <label htmlFor="case-title" className="mb-1.5 block text-sm font-medium">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                id="case-title"
                aria-label="Title"
                type="text"
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

            {/* Description */}
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
              {mutation.isPending ? 'Creating…' : 'Create Case'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests — expect them to pass**

```bash
cd frontend/web && npx vitest run src/components/__tests__/create-case-modal.test.tsx
```

Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/web/src/components/create-case-modal.tsx \
        frontend/web/src/components/__tests__/create-case-modal.test.tsx
git commit -m "feat(cases): add CreateCaseModal component"
```

---

## Chunk 2: Wire modal into Cases page

### Task 3: Update `cases/page.tsx`

**Files:**
- Modify: `frontend/web/src/app/(crm)/cases/page.tsx`

**Reference:** See how `contacts/page.tsx` wires `AddContactModal` — same pattern. Add `useQueryClient`, `useState`, `handleSuccess`, the "+ New Case" button, and `<CreateCaseModal>`.

- [ ] **Step 6: Update cases/page.tsx**

Replace the full file contents:

```tsx
// frontend/web/src/app/(crm)/cases/page.tsx
'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import { CasesList } from '@/components/cases-list';
import { CreateCaseModal } from '@/components/create-case-modal';
import { PluginGate } from '@/components/plugin-gate';
import type { SupportCase } from '@/types/api.types';

const STATUSES: { value: SupportCase['status'] | ''; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

export default function CasesPage() {
  const { token, tenantId } = useAuthStore();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [modalOpen, setModalOpen] = useState(false);
  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const { data, isLoading } = useQuery({
    queryKey: ['cases', tenantId],
    queryFn: () => crmApi.getCases(ctx),
    enabled: Boolean(token && tenantId),
  });

  const filtered = statusFilter
    ? (data?.data ?? []).filter((c) => c.status === statusFilter)
    : (data?.data ?? []);

  function handleSuccess() {
    queryClient.invalidateQueries({ queryKey: ['cases', tenantId] });
  }

  return (
    <PluginGate plugin="customer-care" pluginLabel="Customer Care">
      <div>
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold">Cases</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {data ? `${data.count} support cases` : 'Manage support cases'}
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
              New Case
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            Loading…
          </div>
        ) : (
          <CasesList cases={filtered} />
        )}

        <CreateCaseModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSuccess={handleSuccess}
        />
      </div>
    </PluginGate>
  );
}
```

- [ ] **Step 7: Run the full frontend test suite**

```bash
cd frontend/web && npx vitest run
```

Expected: all tests PASS (no regressions).

- [ ] **Step 8: Commit**

```bash
git add frontend/web/src/app/\(crm\)/cases/page.tsx
git commit -m "feat(cases): wire CreateCaseModal into cases page"
```
