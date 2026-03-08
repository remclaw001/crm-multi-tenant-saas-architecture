# Edit Contact Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a pencil-icon edit button to each contact row that opens a pre-filled modal to update the contact via `PUT /api/v1/plugins/customer-data/customers/:id`.

**Architecture:** Four changes in sequence — add `updateCustomer` to the API client, create a self-contained `EditContactModal` component (same structure as `AddContactModal`), add an Actions column with pencil button to `ContactsList`, then wire state and the modal into `ContactsPage`.

**Tech Stack:** Next.js 15, React 19, TanStack Query v5 (`useMutation`, `useQueryClient`), Zustand (`useAuthStore`), Tailwind CSS, Lucide React (`Pencil`, `X`), Vitest + @testing-library/react.

---

## Project Context

**Frontend dir:** `frontend/web/` — all commands run from here.
**Run tests:** `cd frontend/web && npx vitest run src/` (vitest.config.ts + jsdom env already set up).
**Vitest hoisting rule:** Variables used inside `vi.mock()` factories MUST be declared with `vi.hoisted(() => vi.fn())`, NOT plain `const x = vi.fn()` — otherwise Vitest throws "cannot access before initialization".

**Existing files to read before starting:**
- `src/lib/api-client.ts` — add `updateCustomer` method here
- `src/components/add-contact-modal.tsx` — model for EditContactModal (same structure)
- `src/components/contacts-list.tsx` — add `onEdit` prop + Actions column here
- `src/app/(crm)/contacts/page.tsx` — add `editingContact` state + render modal here

**Backend endpoint already exists:** `PUT /api/v1/plugins/customer-data/customers/:id`
Accepts body: `{ name?: string; email?: string; phone?: string; company?: string }`

**Customer type** (`src/types/api.types.ts`):
```ts
interface Customer {
  id: string;
  tenant_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
```

---

### Task 1: Add `updateCustomer` to the API client

**Files:**
- Modify: `frontend/web/src/lib/api-client.ts`

No unit test needed — it's a thin wrapper identical in pattern to `createCustomer`, tested indirectly via mocks in the modal tests.

**Step 1: Add the method to `crmApi`**

In `src/lib/api-client.ts`, after the `createCustomer` method (around line 111), add:

```ts
  updateCustomer(
    id: string,
    input: { name?: string; email?: string; phone?: string; company?: string },
    ctx: AuthCtx,
  ): Promise<{ plugin: string; data: Customer }> {
    return request(`/api/v1/plugins/customer-data/customers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
      ...ctx,
    });
  },
```

**Step 2: Verify TypeScript**

```bash
cd frontend/web && npx tsc --noEmit 2>&1 | grep "error TS" | head -5
```

Expected: no errors.

**Step 3: Commit**

```bash
git add frontend/web/src/lib/api-client.ts
git commit -m "feat(web): add updateCustomer to api-client"
```

---

### Task 2: Write failing tests for `EditContactModal`

**Files:**
- Create: `frontend/web/src/components/__tests__/edit-contact-modal.test.tsx`

**Step 1: Create the test file**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Customer } from '@/types/api.types';
import { EditContactModal } from '../edit-contact-modal';

// Vitest hoisting — MUST use vi.hoisted() for variables inside vi.mock() factories
const mockMutateAsync = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(() => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  })),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(() => ({ token: 'tok', tenantId: 'tid' })),
}));

vi.mock('@/lib/api-client', () => ({
  crmApi: { updateCustomer: vi.fn() },
}));

const baseContact: Customer = {
  id: 'c-1',
  tenant_id: 't-1',
  name: 'Alice',
  email: 'alice@example.com',
  phone: '0901234567',
  company: 'Acme',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const defaultProps = {
  contact: baseContact,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

describe('EditContactModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders dialog with pre-filled fields from contact', () => {
    render(<EditContactModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/name/i)).toHaveValue('Alice');
    expect(screen.getByLabelText(/email/i)).toHaveValue('alice@example.com');
    expect(screen.getByLabelText(/phone/i)).toHaveValue('0901234567');
    expect(screen.getByLabelText(/company/i)).toHaveValue('Acme');
  });

  it('shows error when submitting with empty name', async () => {
    render(<EditContactModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('shows error when email format is invalid', async () => {
    render(<EditContactModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'bad-email' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('calls mutateAsync with contact id and updated payload', async () => {
    mockMutateAsync.mockResolvedValue({});
    render(<EditContactModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Alice Updated' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        id: 'c-1',
        input: {
          name: 'Alice Updated',
          email: 'alice@example.com',
          phone: '0901234567',
          company: 'Acme',
        },
      }),
    );
  });

  it('calls onSuccess and onClose after successful submit', async () => {
    mockMutateAsync.mockResolvedValue({});
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<EditContactModal contact={baseContact} onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows API error message when mutateAsync throws', async () => {
    mockMutateAsync.mockRejectedValue(new Error('Server error'));
    render(<EditContactModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/failed to save/i)).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(<EditContactModal contact={baseContact} onClose={onClose} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

**Step 2: Run — expect FAIL**

```bash
cd frontend/web && npx vitest run src/components/__tests__/edit-contact-modal.test.tsx --reporter=verbose 2>&1 | tail -10
```

Expected: FAIL with `Cannot find module '../edit-contact-modal'`.

---

### Task 3: Implement `EditContactModal`

**Files:**
- Create: `frontend/web/src/components/edit-contact-modal.tsx`

**Step 1: Create the component**

```tsx
'use client';

import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import type { Customer } from '@/types/api.types';

interface Props {
  contact: Customer;
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

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!form.name.trim()) errors.name = 'Name is required';
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errors.email = 'Please enter a valid email';
  }
  return errors;
}

function contactToForm(c: Customer): FormState {
  return {
    name: c.name,
    email: c.email ?? '',
    phone: c.phone ?? '',
    company: c.company ?? '',
  };
}

export function EditContactModal({ contact, onClose, onSuccess }: Props) {
  const { token, tenantId } = useAuthStore();
  const [form, setForm] = useState<FormState>(() => contactToForm(contact));
  const [errors, setErrors] = useState<FormErrors>({});
  const [apiError, setApiError] = useState('');

  // Reset form when the contact changes (e.g. user opens edit on a different row)
  useEffect(() => {
    setForm(contactToForm(contact));
    setErrors({});
    setApiError('');
  }, [contact]);

  const mutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: { name?: string; email?: string; phone?: string; company?: string } }) =>
      crmApi.updateCustomer(id, input, { token: token ?? '', tenantId: tenantId ?? '' }),
  });

  function handleChange(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
      if (errors[field as keyof FormErrors]) {
        setErrors((prev) => ({ ...prev, [field]: undefined }));
      }
    };
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
      const input: { name: string; email?: string; phone?: string; company?: string } = {
        name: form.name.trim(),
      };
      if (form.email) input.email = form.email;
      if (form.phone) input.phone = form.phone;
      if (form.company) input.company = form.company;

      await mutation.mutateAsync({ id: contact.id, input });
      onSuccess();
      onClose();
    } catch {
      setApiError('Failed to save. Please try again.');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit Contact"
        className="w-full max-w-md rounded-lg bg-card shadow-xl border border-border"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold">Edit Contact</h2>
          <button
            type="button"
            onClick={onClose}
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
              <label htmlFor="edit-contact-name" className="mb-1.5 block text-sm font-medium">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                id="edit-contact-name"
                aria-label="Name"
                type="text"
                value={form.name}
                onChange={handleChange('name')}
                className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                  errors.name ? 'border-red-500' : 'border-border'
                }`}
              />
              {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
            </div>

            {/* Email */}
            <div>
              <label htmlFor="edit-contact-email" className="mb-1.5 block text-sm font-medium">
                Email
              </label>
              <input
                id="edit-contact-email"
                aria-label="Email"
                type="email"
                value={form.email}
                onChange={handleChange('email')}
                className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                  errors.email ? 'border-red-500' : 'border-border'
                }`}
              />
              {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email}</p>}
            </div>

            {/* Phone */}
            <div>
              <label htmlFor="edit-contact-phone" className="mb-1.5 block text-sm font-medium">
                Phone
              </label>
              <input
                id="edit-contact-phone"
                aria-label="Phone"
                type="tel"
                value={form.phone}
                onChange={handleChange('phone')}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Company */}
            <div>
              <label htmlFor="edit-contact-company" className="mb-1.5 block text-sm font-medium">
                Company
              </label>
              <input
                id="edit-contact-company"
                aria-label="Company"
                type="text"
                value={form.company}
                onChange={handleChange('company')}
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
              onClick={onClose}
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
cd frontend/web && npx vitest run src/components/__tests__/edit-contact-modal.test.tsx --reporter=verbose 2>&1 | tail -20
```

Expected: All 6 tests pass.

**Step 3: Commit**

```bash
git add frontend/web/src/components/edit-contact-modal.tsx \
        frontend/web/src/components/__tests__/edit-contact-modal.test.tsx
git commit -m "feat(web): add EditContactModal component with validation"
```

---

### Task 4: Update `ContactsList` — add `onEdit` prop and Actions column

**Files:**
- Modify: `frontend/web/src/components/contacts-list.tsx`
- Create: `frontend/web/src/components/__tests__/contacts-list.test.tsx`

**Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Customer } from '@/types/api.types';
import { ContactsList } from '../contacts-list';

const contact: Customer = {
  id: 'c-1',
  tenant_id: 't-1',
  name: 'Alice',
  email: 'alice@example.com',
  phone: '0901234567',
  company: 'Acme',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('ContactsList', () => {
  it('calls onEdit with the correct contact when pencil button is clicked', () => {
    const onEdit = vi.fn();
    render(<ContactsList contacts={[contact]} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(onEdit).toHaveBeenCalledWith(contact);
  });
});
```

**Step 2: Run — expect FAIL**

```bash
cd frontend/web && npx vitest run src/components/__tests__/contacts-list.test.tsx --reporter=verbose 2>&1 | tail -10
```

Expected: FAIL (ContactsList doesn't accept `onEdit` yet).

**Step 3: Update `ContactsList`**

Read `src/components/contacts-list.tsx` first, then make these changes:

- Change the component signature from `{ contacts }: { contacts: Customer[] }` to:
  ```tsx
  { contacts, onEdit }: { contacts: Customer[]; onEdit: (contact: Customer) => void }
  ```
- Add a final column to the `columns` array — but `columns` is defined outside the component and can't access `onEdit`. The cleanest fix is to move the columns definition inside the component OR use a factory function. Use a factory function:

  Replace the top-level `const columns: ColumnDef<Customer>[] = [...]` with a function:

  ```tsx
  function buildColumns(onEdit: (c: Customer) => void): ColumnDef<Customer>[] {
    return [
      // ... all existing columns unchanged ...
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <button
            onClick={() => onEdit(row.original)}
            aria-label="Edit"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        ),
      },
    ];
  }
  ```

- Add `Pencil` to the lucide-react import: `import { ArrowUpDown, ArrowUp, ArrowDown, Pencil } from 'lucide-react';`
- Inside the component, replace `columns` usage with `buildColumns(onEdit)`:
  ```tsx
  const table = useReactTable({
    data: contacts,
    columns: buildColumns(onEdit),
    ...
  });
  ```

Full updated file:

```tsx
'use client';

// Also exposed as Module Federation remote module (see next.config.ts).
// Admin Console can lazy-load: const ContactsList = React.lazy(() => import('web/ContactsList'));

import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useState } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, Pencil } from 'lucide-react';
import type { Customer } from '@/types/api.types';

function buildColumns(onEdit: (c: Customer) => void): ColumnDef<Customer>[] {
  return [
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <button onClick={() => column.toggleSorting()} className="flex items-center gap-1 font-medium">
          Name
          {column.getIsSorted() === 'asc' ? (
            <ArrowUp className="h-3 w-3" />
          ) : column.getIsSorted() === 'desc' ? (
            <ArrowDown className="h-3 w-3" />
          ) : (
            <ArrowUpDown className="h-3 w-3 opacity-40" />
          )}
        </button>
      ),
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.name}</p>
          {row.original.email && (
            <p className="text-xs text-muted-foreground">{row.original.email}</p>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'company',
      header: 'Company',
      cell: ({ getValue }) => getValue<string | null>() ?? '—',
    },
    {
      accessorKey: 'phone',
      header: 'Phone',
      cell: ({ getValue }) => getValue<string | null>() ?? '—',
    },
    {
      accessorKey: 'is_active',
      header: 'Status',
      cell: ({ getValue }) => {
        const active = getValue<boolean>();
        return (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {active ? 'Active' : 'Inactive'}
          </span>
        );
      },
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <button
          onClick={() => onEdit(row.original)}
          aria-label="Edit"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      ),
    },
  ];
}

export function ContactsList({
  contacts,
  onEdit,
}: {
  contacts: Customer[];
  onEdit: (contact: Customer) => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data: contacts,
    columns: buildColumns(onEdit),
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border bg-muted/30">
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-border transition-colors last:border-0 hover:bg-muted/50"
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {contacts.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No contacts found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

**Step 4: Run tests — expect PASS**

```bash
cd frontend/web && npx vitest run src/components/__tests__/contacts-list.test.tsx --reporter=verbose 2>&1 | tail -10
```

Expected: 1 test passes.

**Step 5: Commit**

```bash
git add frontend/web/src/components/contacts-list.tsx \
        frontend/web/src/components/__tests__/contacts-list.test.tsx
git commit -m "feat(web): add edit action column to ContactsList"
```

---

### Task 5: Wire `EditContactModal` into `ContactsPage`

**Files:**
- Modify: `frontend/web/src/app/(crm)/contacts/page.tsx`

**Step 1: Read the current file first**

Read `frontend/web/src/app/(crm)/contacts/page.tsx` before editing.

**Step 2: Apply the changes**

```tsx
'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import { ContactsList } from '@/components/contacts-list';
import { AddContactModal } from '@/components/add-contact-modal';
import { EditContactModal } from '@/components/edit-contact-modal';
import { PluginGate } from '@/components/plugin-gate';
import type { Customer } from '@/types/api.types';

export default function ContactsPage() {
  const { token, tenantId } = useAuthStore();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Customer | null>(null);

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
          <ContactsList contacts={data?.data ?? []} onEdit={setEditingContact} />
        )}

        <AddContactModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSuccess={handleSuccess}
        />

        {editingContact && (
          <EditContactModal
            contact={editingContact}
            onClose={() => setEditingContact(null)}
            onSuccess={handleSuccess}
          />
        )}
      </div>
    </PluginGate>
  );
}
```

**Step 3: TypeScript check**

```bash
cd frontend/web && npx tsc --noEmit 2>&1 | grep "error TS" | head -10
```

Expected: no errors.

**Step 4: Commit**

```bash
git add "frontend/web/src/app/(crm)/contacts/page.tsx"
git commit -m "feat(web): wire EditContactModal into ContactsPage"
```

---

### Task 6: Manual smoke test in browser

**Step 1: Ensure backend is running**

```bash
curl -s http://localhost:3000/health
```

Expected: `{"status":"ok",...}`

**Step 2: Start the frontend (if not already running)**

```bash
cd frontend/web && NEXT_PUBLIC_API_URL=http://localhost:3000 npm run dev
```

**Step 3: Log in**

Open `http://localhost:3002` → login with tenant: `acme`, email: `admin@acme.example.com`, password: `password123`.

**Step 4: Test happy path**

1. Navigate to Contacts — verify pencil icon appears on each row
2. Click pencil on any contact — verify modal opens titled "Edit Contact" with fields pre-filled
3. Change the name → click Save
4. Verify modal closes and the updated name appears in the list

**Step 5: Test validation**

1. Open edit modal → clear the name field → click Save
2. Verify "Name is required" error
3. Type a bad email → click Save
4. Verify "Please enter a valid email" error

**Step 6: Test close**

1. Open edit modal → click Cancel → verify closed
2. Open edit modal → click X → verify closed
3. Open edit modal → click backdrop → verify closed
