# Delete Contact Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a trash-icon button to each contact row that opens a confirmation modal, then deletes the contact via `DELETE /api/v1/plugins/customer-data/customers/:id`.

**Architecture:** Four changes in sequence — add `deleteCustomer` to the API client, create `DeleteContactModal` (no form, confirmation only), add a `Trash2` button next to the existing `Pencil` button in `ContactsList`, then wire state and the modal into `ContactsPage`.

**Tech Stack:** Next.js 15, React 19, TanStack Query v5 (`useMutation`, `useQueryClient`), Zustand (`useAuthStore`), Tailwind CSS, Lucide React (`Trash2`, `X`), Vitest + @testing-library/react.

---

## Project Context

**Frontend dir:** `frontend/web/` — all commands run from here.
**Run tests:** `cd frontend/web && npx vitest run src/` (vitest.config.ts + jsdom env already set up).
**Vitest hoisting rule:** Variables used inside `vi.mock()` factories MUST be declared with `vi.hoisted(() => vi.fn())` — otherwise Vitest throws "cannot access before initialization".

**Existing files to read before starting:**
- `src/lib/api-client.ts` — add `deleteCustomer` method here
- `src/components/contacts-list.tsx` — add `onDelete` prop + Trash2 button; update `buildColumns`
- `src/components/__tests__/contacts-list.test.tsx` — add test for `onDelete`
- `src/app/(crm)/contacts/page.tsx` — add `deletingContact` state + render modal

**Backend endpoint already exists:** `DELETE /api/v1/plugins/customer-data/customers/:id`
Returns: `204 No Content` on success (the `request()` helper returns `undefined` for 204).

**Customer type** (`src/types/api.types.ts`):
```ts
interface Customer {
  id: string; tenant_id: string; name: string;
  email: string | null; phone: string | null; company: string | null;
  is_active: boolean; created_at: string; updated_at: string;
}
```

**Current `ContactsList` state (important — read before modifying):**
- `buildColumns(onEdit)` factory — takes one callback, returns 5 columns
- Props: `{ contacts: Customer[]; onEdit: (contact: Customer) => void }`
- `useMemo(() => buildColumns(onEdit), [onEdit])` — dep array has only `onEdit`

---

### Task 1: Add `deleteCustomer` to the API client

**Files:**
- Modify: `frontend/web/src/lib/api-client.ts`

**Step 1: Add the method**

Read `src/lib/api-client.ts` first. After `updateCustomer` (around line 123), add:

```ts
  deleteCustomer(id: string, ctx: AuthCtx): Promise<void> {
    return request(`/api/v1/plugins/customer-data/customers/${id}`, {
      method: 'DELETE',
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
git commit -m "feat(web): add deleteCustomer to api-client"
```

---

### Task 2: Write failing tests for `DeleteContactModal`

**Files:**
- Create: `frontend/web/src/components/__tests__/delete-contact-modal.test.tsx`

**Step 1: Create the test file**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Customer } from '@/types/api.types';
import { DeleteContactModal } from '../delete-contact-modal';

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

vi.mock('@/lib/api-client', () => ({
  crmApi: { deleteCustomer: vi.fn() },
}));

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

const defaultProps = {
  contact,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

describe('DeleteContactModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders dialog with contact name', () => {
    render(<DeleteContactModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
  });

  it('calls mutateAsync with contact id on confirm', async () => {
    mockMutateAsync.mockResolvedValue(undefined);
    render(<DeleteContactModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledWith('c-1'));
  });

  it('calls onSuccess and onClose after successful delete', async () => {
    mockMutateAsync.mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<DeleteContactModal contact={contact} onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows API error when mutateAsync throws', async () => {
    mockMutateAsync.mockRejectedValue(new Error('Server error'));
    render(<DeleteContactModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(await screen.findByText(/failed to delete/i)).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(<DeleteContactModal contact={contact} onClose={onClose} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

**Step 2: Run — expect FAIL**

```bash
cd frontend/web && npx vitest run src/components/__tests__/delete-contact-modal.test.tsx --reporter=verbose 2>&1 | tail -10
```

Expected: FAIL with `Cannot find module '../delete-contact-modal'`.

---

### Task 3: Implement `DeleteContactModal`

**Files:**
- Create: `frontend/web/src/components/delete-contact-modal.tsx`

**Step 1: Create the component**

```tsx
'use client';

import { useState } from 'react';
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

export function DeleteContactModal({ contact, onClose, onSuccess }: Props) {
  const { token, tenantId } = useAuthStore();
  const [apiError, setApiError] = useState('');

  const mutation = useMutation({
    mutationFn: (id: string) =>
      crmApi.deleteCustomer(id, { token: token ?? '', tenantId: tenantId ?? '' }),
  });

  async function handleDelete() {
    setApiError('');
    try {
      await mutation.mutateAsync(contact.id);
      onSuccess();
      onClose();
    } catch {
      setApiError('Failed to delete. Please try again.');
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
        aria-label="Delete Contact"
        className="w-full max-w-sm rounded-lg bg-card shadow-xl border border-border"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold">Delete Contact</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={mutation.isPending}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete{' '}
            <span className="font-semibold text-foreground">{contact.name}</span>?
            This action cannot be undone.
          </p>
          {apiError && (
            <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
              {apiError}
            </p>
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
            type="button"
            onClick={handleDelete}
            disabled={mutation.isPending}
            className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >
            {mutation.isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Run tests — expect PASS**

```bash
cd frontend/web && npx vitest run src/components/__tests__/delete-contact-modal.test.tsx --reporter=verbose 2>&1 | tail -15
```

Expected: All 5 tests pass.

**Step 3: Commit**

```bash
git add frontend/web/src/components/delete-contact-modal.tsx \
        frontend/web/src/components/__tests__/delete-contact-modal.test.tsx
git commit -m "feat(web): add DeleteContactModal component"
```

---

### Task 4: Update `ContactsList` — add `onDelete` prop and Trash2 button

**Files:**
- Modify: `frontend/web/src/components/contacts-list.tsx`
- Modify: `frontend/web/src/components/__tests__/contacts-list.test.tsx`

**Step 1: Add failing test to existing contacts-list test file**

Read `src/components/__tests__/contacts-list.test.tsx` first, then add this test inside the existing `describe('ContactsList', ...)` block:

```tsx
  it('calls onDelete with the correct contact when trash button is clicked', () => {
    const onDelete = vi.fn();
    render(<ContactsList contacts={[contact]} onEdit={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith(contact);
  });
```

**Step 2: Run — expect FAIL**

```bash
cd frontend/web && npx vitest run src/components/__tests__/contacts-list.test.tsx --reporter=verbose 2>&1 | tail -10
```

Expected: FAIL (ContactsList doesn't accept `onDelete` yet, TypeScript error or runtime failure).

**Step 3: Update `ContactsList`**

Read `src/components/contacts-list.tsx` first, then make these changes:

1. Add `Trash2` to the lucide-react import:
   ```tsx
   import { ArrowUpDown, ArrowUp, ArrowDown, Pencil, Trash2 } from 'lucide-react';
   ```

2. Change `buildColumns` signature to accept `onDelete`:
   ```tsx
   function buildColumns(
     onEdit: (c: Customer) => void,
     onDelete: (c: Customer) => void,
   ): ColumnDef<Customer>[] {
   ```

3. In the `actions` column cell, add the Trash2 button after the Pencil button:
   ```tsx
       {
         id: 'actions',
         header: '',
         cell: ({ row }) => (
           <div className="flex items-center gap-1">
             <button
               onClick={() => onEdit(row.original)}
               aria-label="Edit"
               className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
             >
               <Pencil className="h-3.5 w-3.5" />
             </button>
             <button
               onClick={() => onDelete(row.original)}
               aria-label="Delete"
               className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
             >
               <Trash2 className="h-3.5 w-3.5" />
             </button>
           </div>
         ),
       },
   ```

4. Update the component props and useMemo:
   ```tsx
   export function ContactsList({
     contacts,
     onEdit,
     onDelete,
   }: {
     contacts: Customer[];
     onEdit: (contact: Customer) => void;
     onDelete: (contact: Customer) => void;
   }) {
     const [sorting, setSorting] = useState<SortingState>([]);
     const columns = useMemo(() => buildColumns(onEdit, onDelete), [onEdit, onDelete]);
   ```

**Step 4: Run tests — expect PASS**

```bash
cd frontend/web && npx vitest run src/components/__tests__/contacts-list.test.tsx --reporter=verbose 2>&1 | tail -10
```

Expected: 2 tests pass (onEdit + onDelete).

**Step 5: TypeScript check**

```bash
cd frontend/web && npx tsc --noEmit 2>&1 | grep "error TS" | head -10
```

Note: tsc will likely flag `contacts/page.tsx` because `ContactsList` now requires `onDelete` but the page hasn't been updated yet. That's acceptable here — it will be fixed in Task 5. Focus on no errors in `contacts-list.tsx` itself.

**Step 6: Commit**

```bash
git add frontend/web/src/components/contacts-list.tsx \
        frontend/web/src/components/__tests__/contacts-list.test.tsx
git commit -m "feat(web): add delete action to ContactsList"
```

---

### Task 5: Wire `DeleteContactModal` into `ContactsPage`

**Files:**
- Modify: `frontend/web/src/app/(crm)/contacts/page.tsx`

**Step 1: Read the current file first**

Read `frontend/web/src/app/(crm)/contacts/page.tsx`.

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
import { DeleteContactModal } from '@/components/delete-contact-modal';
import { PluginGate } from '@/components/plugin-gate';
import type { Customer } from '@/types/api.types';

export default function ContactsPage() {
  const { token, tenantId } = useAuthStore();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Customer | null>(null);
  const [deletingContact, setDeletingContact] = useState<Customer | null>(null);

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
          <ContactsList
            contacts={data?.data ?? []}
            onEdit={setEditingContact}
            onDelete={setDeletingContact}
          />
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

        {deletingContact && (
          <DeleteContactModal
            contact={deletingContact}
            onClose={() => setDeletingContact(null)}
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

**Step 4: Run all tests**

```bash
cd frontend/web && npx vitest run src/ --reporter=verbose 2>&1 | tail -20
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add "frontend/web/src/app/(crm)/contacts/page.tsx"
git commit -m "feat(web): wire DeleteContactModal into ContactsPage"
```

---

### Task 6: Manual smoke test

**Step 1: Ensure backend is running**

```bash
curl -s http://localhost:3000/health
```

**Step 2: Start frontend (if not running)**

```bash
cd frontend/web && NEXT_PUBLIC_API_URL=http://localhost:3000 npm run dev
```

**Step 3: Log in**

Open `http://localhost:3002` → login: tenant `acme`, email `admin@acme.example.com`, password `password123`.

**Step 4: Happy path**

1. Go to Contacts — verify each row has both pencil ✏️ and trash 🗑️ icons
2. Click trash on any contact — verify confirmation modal opens with contact name
3. Click Delete — verify modal closes and contact disappears from list

**Step 5: Cancel path**

1. Click trash → modal opens → click Cancel → verify modal closes, contact still in list
2. Click trash → modal opens → click backdrop → verify modal closes

**Step 6: Error path** (optional, requires network tab or mock)

Verify "Failed to delete. Please try again." appears if the API call fails.
