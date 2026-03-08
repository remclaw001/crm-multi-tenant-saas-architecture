# Add Contact Modal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an "Add Contact" button to the Contacts page that opens a modal dialog for creating a new customer via the customer-data plugin.

**Architecture:** A new self-contained `AddContactModal` component handles its own form state, client-side validation, and `useMutation` call. The Contacts page controls open/close state and triggers cache invalidation on success. No external component library — pure Tailwind + Lucide icons.

**Tech Stack:** Next.js 15, React 19, TanStack Query v5 (`useMutation`, `useQueryClient`), Zustand (`useAuthStore`), Tailwind CSS, Lucide React, Vitest + @testing-library/react.

---

## Project Context

**Frontend directory:** `frontend/web/`
**Run all commands from:** `frontend/web/`
**Run tests:** `npx vitest run src/` (no config file — uses package.json defaults + jsdom)
**API method:** `crmApi.createCustomer(input, ctx)` in `src/lib/api-client.ts`
**Auth:** `useAuthStore()` → `{ token, tenantId }` from `src/stores/auth.store.ts`
**Query key for contacts list:** `['customers', tenantId]`

**Existing files to understand before starting:**
- `src/components/contacts-list.tsx` — existing list component (read-only table)
- `src/app/(crm)/contacts/page.tsx` — current page (query + render ContactsList)
- `src/lib/api-client.ts` — `createCustomer(input, ctx)` already exists

**Fields accepted by backend `POST /api/v1/plugins/customer-data/customers`:**
- `name` (string, required)
- `email` (string, optional, must be valid email)
- `phone` (string, optional)
- `company` (string, optional)

---

### Task 1: Write failing tests for `AddContactModal`

**Files:**
- Create: `frontend/web/src/components/__tests__/add-contact-modal.test.tsx`

**Context:** No test directory exists yet. Vitest uses jsdom (from `package.json` devDependencies). Tests use `@testing-library/react` and `@testing-library/jest-dom`. The component does not exist yet — tests will fail with "Cannot find module".

**Step 1: Create the test file**

```tsx
// frontend/web/src/components/__tests__/add-contact-modal.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AddContactModal } from '../add-contact-modal';

// Mock TanStack Query
const mockMutateAsync = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(() => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  })),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));

// Mock auth store
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(() => ({ token: 'tok', tenantId: 'tid' })),
}));

// Mock api-client
vi.mock('@/lib/api-client', () => ({
  crmApi: { createCustomer: vi.fn() },
}));

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

describe('AddContactModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when open=false', () => {
    render(<AddContactModal {...defaultProps} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders dialog with all fields when open=true', () => {
    render(<AddContactModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/phone/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/company/i)).toBeInTheDocument();
  });

  it('shows error when submitting with empty name', async () => {
    render(<AddContactModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('shows error when email format is invalid', async () => {
    render(<AddContactModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('calls mutateAsync with correct payload on valid submit', async () => {
    mockMutateAsync.mockResolvedValue({});
    render(<AddContactModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'alice@example.com' } });
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '0901234567' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledWith({
      name: 'Alice',
      email: 'alice@example.com',
      phone: '0901234567',
    }));
  });

  it('calls onSuccess and onClose after successful submit', async () => {
    mockMutateAsync.mockResolvedValue({});
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<AddContactModal open={true} onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Bob' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows API error message when mutateAsync throws', async () => {
    mockMutateAsync.mockRejectedValue(new Error('Server error'));
    render(<AddContactModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Bob' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/failed to save/i)).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(<AddContactModal open={true} onClose={onClose} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

**Step 2: Run tests — expect FAIL**

```bash
cd frontend/web && npx vitest run src/components/__tests__/add-contact-modal.test.tsx --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL with `Cannot find module '../add-contact-modal'`.

---

### Task 2: Implement `AddContactModal` component

**Files:**
- Create: `frontend/web/src/components/add-contact-modal.tsx`

**Step 1: Create the component**

```tsx
// frontend/web/src/components/add-contact-modal.tsx
'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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

  const mutation = useMutation({
    mutationFn: (input: Omit<FormState, 'company'> & { company?: string }) =>
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
      const payload: Record<string, string> = { name: form.name.trim() };
      if (form.email) payload.email = form.email;
      if (form.phone) payload.phone = form.phone;
      if (form.company) payload.company = form.company;

      await mutation.mutateAsync(payload as any);
      setForm(EMPTY_FORM);
      setErrors({});
      onSuccess();
      onClose();
    } catch {
      setApiError('Failed to save contact. Please try again.');
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
```

**Step 2: Run tests — expect PASS**

```bash
cd frontend/web && npx vitest run src/components/__tests__/add-contact-modal.test.tsx --reporter=verbose 2>&1 | tail -20
```

Expected: All 7 tests pass.

**Step 3: Commit**

```bash
git add frontend/web/src/components/add-contact-modal.tsx \
        frontend/web/src/components/__tests__/add-contact-modal.test.tsx
git commit -m "feat(web): add AddContactModal component with validation"
```

---

### Task 3: Wire modal into `contacts/page.tsx`

**Files:**
- Modify: `frontend/web/src/app/(crm)/contacts/page.tsx`

**Step 1: Read the current file**

Read `frontend/web/src/app/(crm)/contacts/page.tsx` before editing.

**Step 2: Replace the file with the updated version**

```tsx
// frontend/web/src/app/(crm)/contacts/page.tsx
'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import { ContactsList } from '@/components/contacts-list';
import { AddContactModal } from '@/components/add-contact-modal';
import { PluginGate } from '@/components/plugin-gate';

export default function ContactsPage() {
  const { token, tenantId } = useAuthStore();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);

  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['customers', tenantId],
    queryFn: () => crmApi.getCustomers(ctx),
    enabled: Boolean(token && tenantId),
  });

  function handleSuccess() {
    queryClient.invalidateQueries({ queryKey: ['customers', tenantId] });
  }

  return (
    <PluginGate plugin="customer-data" pluginLabel="Customer Data">
      <div>
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold">Contacts</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {data ? `${data.count} contacts` : 'Manage your contacts'}
            </p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Add Contact
          </button>
        </div>

        {isLoading ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            Loading…
          </div>
        ) : isError ? (
          <div className="flex h-64 items-center justify-center text-red-600">
            Failed to load contacts.
          </div>
        ) : (
          <ContactsList contacts={data?.data ?? []} />
        )}

        <AddContactModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSuccess={handleSuccess}
        />
      </div>
    </PluginGate>
  );
}
```

**Step 3: Verify TypeScript (optional but recommended)**

```bash
cd frontend/web && npx tsc --noEmit 2>&1 | grep -E "error TS|contacts|add-contact" | head -10
```

Expected: no errors in the files we touched.

**Step 4: Commit**

```bash
git add "frontend/web/src/app/(crm)/contacts/page.tsx"
git commit -m "feat(web): wire AddContactModal into ContactsPage"
```

---

### Task 4: Manual smoke test in browser

**Step 1: Ensure backend is running**

```bash
# Check backend health
curl -s http://localhost:3000/health
```

Expected: `{"status":"ok",...}`

**Step 2: Start the frontend dev server (if not already running)**

```bash
cd frontend/web && NEXT_PUBLIC_API_URL=http://localhost:3000 npm run dev
```

Expected: `Ready on http://localhost:3002`

**Step 3: Log in**

Open `http://localhost:3002` → login with:
- Tenant slug: `acme`
- Email: `admin@acme.example.com`
- Password: `password123`

**Step 4: Test the happy path**

1. Navigate to Contacts
2. Click "Add Contact"
3. Verify modal opens with 4 fields
4. Fill: Name = "Test User", Email = "test@example.com", Phone = "0901234567"
5. Click Save
6. Verify modal closes and new contact appears in the list

**Step 5: Test validation**

1. Click "Add Contact"
2. Click Save immediately (no input)
3. Verify "Name is required" error appears
4. Type "Bob" in name, type "bad-email" in email
5. Click Save
6. Verify "Please enter a valid email" error appears

**Step 6: Test close behaviors**

1. Open modal → click Cancel → verify modal closes
2. Open modal → click X button → verify modal closes
3. Open modal → click backdrop (outside card) → verify modal closes

**Step 7: Commit if any fixes were needed**

```bash
git add -A && git status  # check if any files changed during smoke test
```

Only commit if actual code changes were needed.
