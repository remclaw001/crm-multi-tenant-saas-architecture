# Contacts Filter Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side filtering to the contacts list — filter by name, company, phone, and status via query params.

**Architecture:** Backend `listCustomers` gains an optional `ListCustomersFilter` param and builds a Knex query with conditional `WHERE` clauses. The controller adds `@Query()` decorators and passes a filter object down to the core. The frontend `getCustomers` API method builds a query string from a `CustomerFilter` object; the contacts page maintains two state slices (`filterForm` for typing, `activeFilter` for the submitted query) and renders a `<form>` row above the table.

**Tech Stack:** NestJS 10, Knex, Vitest (backend); React 19, Next.js 15, TanStack Query v5, Tailwind CSS, Vitest + Testing Library (frontend).

---

## File Map

| File | Status | Change |
|---|---|---|
| `backend/src/plugins/cores/customer-data/customer-data.core.ts` | **Modify** | Add `ListCustomersFilter` interface; update `listCustomers` signature + Knex query |
| `backend/src/plugins/__tests__/customer-data.core.test.ts` | **Modify** | Add 7 filter test cases to existing `listCustomers` describe block |
| `backend/src/plugins/cores/customer-data/customer-data.controller.ts` | **Modify** | Add `Query` to NestJS import; add `@Query()` params; pass `filter` to core |
| `frontend/web/src/lib/api-client.ts` | **Modify** | Add `CustomerFilter` type; update `getCustomers` to build query string |
| `frontend/web/src/app/(plugins)/contacts/page.tsx` | **Modify** | Add filter state + `<form>` row; update `useQuery` key and `queryFn` |

All backend commands run from `backend/`. All frontend commands run from `frontend/web/`.

---

## Chunk 1: Backend — core filter logic

### Task 1: Update `CustomerDataCore.listCustomers` — TDD

**Files:**
- Modify: `backend/src/plugins/__tests__/customer-data.core.test.ts`
- Modify: `backend/src/plugins/cores/customer-data/customer-data.core.ts`

- [ ] **Step 1: Add failing filter tests**

Open `backend/src/plugins/__tests__/customer-data.core.test.ts`.

Inside the existing `describe('listCustomers', ...)` block (after the existing `'queries customers table'` test), add these 7 new tests:

```ts
  it('applies is_active=true filter by default (no filter arg)', async () => {
    const ctx = makeCtx({ limit: vi.fn().mockResolvedValue([]) });
    await core.listCustomers(ctx);
    expect(ctx.db._builder.where).toHaveBeenCalledWith('is_active', true);
  });

  it('applies is_active=true when status is "active"', async () => {
    const ctx = makeCtx({ limit: vi.fn().mockResolvedValue([]) });
    await core.listCustomers(ctx, { status: 'active' });
    expect(ctx.db._builder.where).toHaveBeenCalledWith('is_active', true);
  });

  it('applies is_active=false when status is "inactive"', async () => {
    const ctx = makeCtx({ limit: vi.fn().mockResolvedValue([]) });
    await core.listCustomers(ctx, { status: 'inactive' });
    expect(ctx.db._builder.where).toHaveBeenCalledWith('is_active', false);
  });

  it('does not filter is_active when status is "all"', async () => {
    const ctx = makeCtx({ limit: vi.fn().mockResolvedValue([]) });
    await core.listCustomers(ctx, { status: 'all' });
    expect(ctx.db._builder.where).not.toHaveBeenCalledWith('is_active', true);
    expect(ctx.db._builder.where).not.toHaveBeenCalledWith('is_active', false);
  });

  it('applies ILIKE filter for name', async () => {
    const ctx = makeCtx({ limit: vi.fn().mockResolvedValue([]) });
    await core.listCustomers(ctx, { name: 'nguyen' });
    expect(ctx.db._builder.where).toHaveBeenCalledWith('name', 'ilike', '%nguyen%');
  });

  it('applies ILIKE filter for company', async () => {
    const ctx = makeCtx({ limit: vi.fn().mockResolvedValue([]) });
    await core.listCustomers(ctx, { company: 'acme' });
    expect(ctx.db._builder.where).toHaveBeenCalledWith('company', 'ilike', '%acme%');
  });

  it('applies ILIKE filter for phone', async () => {
    const ctx = makeCtx({ limit: vi.fn().mockResolvedValue([]) });
    await core.listCustomers(ctx, { phone: '0912' });
    expect(ctx.db._builder.where).toHaveBeenCalledWith('phone', 'ilike', '%0912%');
  });

  it('combines multiple filters with AND logic', async () => {
    const ctx = makeCtx({ limit: vi.fn().mockResolvedValue([]) });
    await core.listCustomers(ctx, { status: 'inactive', name: 'bob', company: 'xyz' });
    expect(ctx.db._builder.where).toHaveBeenCalledWith('is_active', false);
    expect(ctx.db._builder.where).toHaveBeenCalledWith('name', 'ilike', '%bob%');
    expect(ctx.db._builder.where).toHaveBeenCalledWith('company', 'ilike', '%xyz%');
  });
```

> **Note:** The `makeCtx` helper exposes `ctx.db._builder` — the chainable mock object. Each call to `.where()` on it is recorded and returns `this`, enabling assertion of all `.where()` calls.

- [ ] **Step 2: Run failing tests**

```bash
cd /home/leo/Projects/VCC/crm-multi-tenant-saas-architecture/backend
npx vitest run src/plugins/__tests__/customer-data.core.test.ts
```

Expected: 7 new tests FAIL (existing tests still pass since `listCustomers(ctx)` with no filter still works).

- [ ] **Step 3: Implement `ListCustomersFilter` + update `listCustomers`**

Open `backend/src/plugins/cores/customer-data/customer-data.core.ts`.

**a)** Add `ListCustomersFilter` interface after the existing `UpdateCustomerInput` interface (after line 46):

```ts
export interface ListCustomersFilter {
  name?:    string;
  company?: string;
  phone?:   string;
  status?:  'active' | 'inactive' | 'all';
}
```

**b)** Replace the existing `listCustomers` method (lines 77–84):

```ts
async listCustomers(ctx: IExecutionContext, filter: ListCustomersFilter = {}): Promise<Customer[]> {
  let query = ctx.db
    .db('customers')
    .select('id', 'tenant_id', 'name', 'email', 'phone', 'company', 'is_active', 'created_at', 'updated_at');

  // Status filter — default: active only
  if (!filter.status || filter.status === 'active') {
    query = query.where('is_active', true);
  } else if (filter.status === 'inactive') {
    query = query.where('is_active', false);
  }
  // status === 'all' → no is_active condition

  if (filter.name)    query = query.where('name',    'ilike', `%${filter.name}%`);
  if (filter.company) query = query.where('company', 'ilike', `%${filter.company}%`);
  if (filter.phone)   query = query.where('phone',   'ilike', `%${filter.phone}%`);

  return query.orderBy('created_at', 'desc').limit(100) as Promise<Customer[]>;
}
```

- [ ] **Step 4: Run all tests — confirm all pass**

```bash
npx vitest run src/plugins/__tests__/customer-data.core.test.ts
```

Expected: all tests pass (7 new + all existing).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/cores/customer-data/customer-data.core.ts \
        src/plugins/__tests__/customer-data.core.test.ts
git commit -m "feat(customer-data): add ListCustomersFilter to listCustomers"
```

---

### Task 2: Update `CustomerDataController` — add `@Query()` params

**Files:**
- Modify: `backend/src/plugins/cores/customer-data/customer-data.controller.ts`

No new tests needed for the controller — NestJS controller wiring is covered by integration tests. The unit-testable logic lives in the core (Task 1).

- [ ] **Step 1: Add `Query` to the NestJS import**

Open `backend/src/plugins/cores/customer-data/customer-data.controller.ts`.

Find the `@nestjs/common` import (line 1–14):
```ts
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  HttpCode,
  ForbiddenException,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
```

Add `Query` to the list:
```ts
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  HttpCode,
  ForbiddenException,
  Req,
  UsePipes,
  ValidationPipe,
  Query,
} from '@nestjs/common';
```

- [ ] **Step 2: Update `listCustomers` in the controller**

Find the existing `listCustomers` method (lines 50–62):
```ts
  @Get('customers')
  async listCustomers(
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const customers = await this.sandbox.execute(
      () => this.core.listCustomers(ctx),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: customers, count: customers.length };
  }
```

Replace with:
```ts
  @Get('customers')
  async listCustomers(
    @Query('name')    name?: string,
    @Query('company') company?: string,
    @Query('phone')   phone?: string,
    @Query('status')  status?: 'active' | 'inactive' | 'all',
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser()   user: JwtClaims,
    @Req()           req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const filter = { name, company, phone, status };
    const customers = await this.sandbox.execute(
      () => this.core.listCustomers(ctx, filter),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: customers, count: customers.length };
  }
```

- [ ] **Step 3: Run the full backend test suite**

```bash
npx vitest run
```

Expected: all tests pass (including the core filter tests from Task 1).

- [ ] **Step 4: Commit**

```bash
git add src/plugins/cores/customer-data/customer-data.controller.ts
git commit -m "feat(customer-data): add query param filtering to listCustomers endpoint"
```

---

## Chunk 2: Frontend — API client + contacts page

### Task 3: Update `api-client.ts` — add `CustomerFilter`

**Files:**
- Modify: `frontend/web/src/lib/api-client.ts`

No dedicated test file for `api-client.ts` — URL construction is a simple pure function verified by the contacts page tests in Task 4.

- [ ] **Step 1: Add `CustomerFilter` type and update `getCustomers`**

Open `frontend/web/src/lib/api-client.ts`.

**a)** Add `CustomerFilter` interface immediately before the `export const crmApi = {` line (around line 67). Add it as a standalone export:

```ts
export interface CustomerFilter {
  name?:    string;
  company?: string;
  phone?:   string;
  status?:  'active' | 'inactive' | 'all';
}
```

**b)** Replace the existing `getCustomers` method (lines 98–100):

```ts
  getCustomers(ctx: AuthCtx): Promise<PluginListResponse<Customer>> {
    return request('/api/v1/plugins/customer-data/customers', ctx);
  },
```

Replace with:

```ts
  getCustomers(ctx: AuthCtx, filter?: CustomerFilter): Promise<PluginListResponse<Customer>> {
    const params = new URLSearchParams();
    const name    = filter?.name?.trim()    ?? '';
    const company = filter?.company?.trim() ?? '';
    const phone   = filter?.phone?.trim()   ?? '';
    if (name)           params.set('name',    name);
    if (company)        params.set('company', company);
    if (phone)          params.set('phone',   phone);
    if (filter?.status) params.set('status',  filter.status);
    const qs = params.toString();
    return request(
      `/api/v1/plugins/customer-data/customers${qs ? `?${qs}` : ''}`,
      ctx,
    );
  },
```

- [ ] **Step 2: Run frontend tests**

```bash
cd /home/leo/Projects/VCC/crm-multi-tenant-saas-architecture/frontend/web
npm test
```

Expected: all tests pass (no regressions — `getCustomers` is backward-compatible: callers that omit `filter` still work).

- [ ] **Step 3: Commit**

```bash
git add src/lib/api-client.ts
git commit -m "feat(contacts): add CustomerFilter type and update getCustomers"
```

---

### Task 4: Update `contacts/page.tsx` — add filter form

**Files:**
- Modify: `frontend/web/src/app/(plugins)/contacts/page.tsx`

There is no existing page-level test file for `contacts/page.tsx`. We write a new one first (TDD).

- [ ] **Step 1: Write failing tests**

Create `frontend/web/src/app/(plugins)/contacts/__tests__/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ContactsPage from '../page';

// ── Hoisted mocks ──────────────────────────────────────────────────────────
const mockUseQuery = vi.hoisted(() => vi.fn());
const mockInvalidateQueries = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useQuery:       mockUseQuery,
  useQueryClient: vi.fn(() => ({ invalidateQueries: mockInvalidateQueries })),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(() => ({ token: 'tok', tenantId: 'tid' })),
}));

vi.mock('@/lib/api-client', () => ({
  crmApi: { getCustomers: vi.fn().mockResolvedValue({ data: [], count: 0 }) },
}));

vi.mock('@/components/plugin-gate', () => ({
  PluginGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/contacts-list', () => ({
  ContactsList: () => <div data-testid="contacts-list" />,
}));

vi.mock('@/components/add-contact-modal', () => ({
  AddContactModal: () => null,
}));

vi.mock('@/components/edit-contact-modal', () => ({
  EditContactModal: () => null,
}));

vi.mock('@/components/delete-contact-modal', () => ({
  DeleteContactModal: () => null,
}));

// ── Helpers ────────────────────────────────────────────────────────────────
function setup() {
  mockUseQuery.mockReturnValue({ data: { data: [], count: 0 }, isLoading: false, isError: false });
  return render(<ContactsPage />);
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('ContactsPage filter form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Name, Company, Phone inputs and Status select', () => {
    setup();
    expect(screen.getByPlaceholderText(/nguyen/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/acme/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/0912/i)).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('Status select defaults to "active"', () => {
    setup();
    expect(screen.getByRole('combobox')).toHaveValue('active');
  });

  it('renders Search and Reset buttons', () => {
    setup();
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument();
  });

  it('pressing Enter in the Name field calls useQuery with updated filter', () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText(/nguyen/i), { target: { value: 'Alice' } });
    fireEvent.submit(screen.getByRole('form'));
    // After submit, useQuery should have been called with the new filter
    // The latest call args contain the activeFilter
    const lastCallArgs = mockUseQuery.mock.calls.at(-1)?.[0];
    expect(lastCallArgs?.queryKey).toContainEqual(expect.objectContaining({ name: 'Alice' }));
  });

  it('changing Status dropdown triggers re-query immediately', () => {
    setup();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'inactive' } });
    const lastCallArgs = mockUseQuery.mock.calls.at(-1)?.[0];
    expect(lastCallArgs?.queryKey).toContainEqual(expect.objectContaining({ status: 'inactive' }));
  });

  it('Reset button restores Status to "active" and clears text fields', () => {
    setup();
    // Type something
    fireEvent.change(screen.getByPlaceholderText(/nguyen/i), { target: { value: 'Bob' } });
    fireEvent.submit(screen.getByRole('form'));
    // Reset
    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect(screen.getByPlaceholderText(/nguyen/i)).toHaveValue('');
    expect(screen.getByRole('combobox')).toHaveValue('active');
    const lastCallArgs = mockUseQuery.mock.calls.at(-1)?.[0];
    expect(lastCallArgs?.queryKey).toContainEqual(expect.objectContaining({ status: 'active' }));
  });
});
```

> **Note:** The test uses `getByRole('form')` — this requires the `<form>` in the page to have `aria-label` or `role="form"`. We'll add `aria-label="Contact filters"` to the form in the implementation step.

- [ ] **Step 2: Run failing tests**

```bash
cd /home/leo/Projects/VCC/crm-multi-tenant-saas-architecture/frontend/web
npx vitest run src/app/\(plugins\)/contacts/__tests__/page.test.tsx
```

Expected: all 6 tests FAIL (the page doesn't have a filter form yet).

- [ ] **Step 3: Update `contacts/page.tsx`**

Open `frontend/web/src/app/(plugins)/contacts/page.tsx`. Replace the entire file with:

```tsx
'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import type { CustomerFilter } from '@/lib/api-client';
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

  // Form state — what the user is currently typing (not yet submitted)
  const [filterForm, setFilterForm] = useState({
    name:    '',
    company: '',
    phone:   '',
    status:  'active' as 'active' | 'inactive' | 'all',
  });

  // Active filter — triggers the actual API call when changed
  const [activeFilter, setActiveFilter] = useState<CustomerFilter>({ status: 'active' });

  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['customers', tenantId, activeFilter],
    queryFn:  () => crmApi.getCustomers(ctx, activeFilter),
    enabled:  Boolean(token && tenantId),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setActiveFilter({ ...filterForm });
  }

  function handleReset() {
    const defaults = { name: '', company: '', phone: '', status: 'active' as const };
    setFilterForm(defaults);
    setActiveFilter({ status: 'active' });
  }

  function handleSuccess() {
    queryClient.invalidateQueries({ queryKey: ['customers', tenantId] });
  }

  return (
    <PluginGate plugin="customer-data" pluginLabel="Customer Data">
      <div>
        {/* Page header */}
        <div className="mb-4 flex items-start justify-between">
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

        {/* Filter form */}
        <form
          aria-label="Contact filters"
          onSubmit={handleSubmit}
          className="mb-4 flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted/30 p-3"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Name
            </label>
            <input
              type="text"
              value={filterForm.name}
              onChange={(e) => setFilterForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Nguyen…"
              className="w-32 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Company
            </label>
            <input
              type="text"
              value={filterForm.company}
              onChange={(e) => setFilterForm((f) => ({ ...f, company: e.target.value }))}
              placeholder="e.g. Acme…"
              className="w-32 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Phone
            </label>
            <input
              type="text"
              value={filterForm.phone}
              onChange={(e) => setFilterForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="e.g. 0912…"
              className="w-28 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Status
            </label>
            <select
              value={filterForm.status}
              onChange={(e) => {
                const status = e.target.value as 'active' | 'inactive' | 'all';
                // Merge current form (including unsaved text) + new status → submit immediately
                // Use closure value directly (not functional updater) to avoid double-call in React Strict Mode
                const updated = { ...filterForm, status };
                setFilterForm(updated);
                setActiveFilter(updated);
              }}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All</option>
            </select>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
            >
              Search
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
            >
              Reset
            </button>
          </div>
        </form>

        {/* Contacts table */}
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

- [ ] **Step 4: Run tests — confirm all 6 pass**

```bash
npx vitest run src/app/\(plugins\)/contacts/__tests__/page.test.tsx
```

Expected: `Tests  6 passed (6)`.

- [ ] **Step 5: Run full frontend test suite — no regressions**

```bash
npm test
```

Expected: all tests pass (or same pre-existing failures as before, if any).

- [ ] **Step 6: Commit**

```bash
git add src/app/\(plugins\)/contacts/page.tsx \
        src/app/\(plugins\)/contacts/__tests__/page.test.tsx
git commit -m "feat(contacts): add filter form with server-side filtering"
```

---

## Final Check

- [ ] **Run full backend test suite**

```bash
cd /home/leo/Projects/VCC/crm-multi-tenant-saas-architecture/backend
npx vitest run
```

Expected: all tests pass.

- [ ] **Run full frontend test suite**

```bash
cd /home/leo/Projects/VCC/crm-multi-tenant-saas-architecture/frontend/web
npm test
```

Expected: all tests pass.

- [ ] **Manual smoke test** (optional but recommended)
  1. Start stack: `docker compose up -d` from repo root
  2. Open `http://localhost:3002`, log in as `admin@acme.example.com` / `password123`
  3. Navigate to Contacts
  4. Type "Alice" in the Name field → press Enter → table updates
  5. Change Status to "Inactive" → table updates immediately (no Enter needed)
  6. Click Reset → all fields clear, Status back to Active
  7. Type a partial phone number → Search → table updates
