# Edit Case Modal Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to edit an existing support case by clicking its card, opening a pre-filled modal with title, description, status, priority, and assigned-to (user dropdown).

**Architecture:** New `GET /api/v1/users` backend endpoint (tenant-scoped via RLS + `QueryInterceptor`) feeds the Assigned To dropdown. `EditCaseModal` follows the `EditContactModal` mount/unmount pattern (no `open` prop — parent conditionally renders). `CasesList` gains an `onEdit` prop; each card becomes clickable. `cases/page.tsx` wires state and modal.

**Tech Stack:** NestJS 10 + Knex (backend), Next.js 15 + React 19 + TanStack Query v5 + Vitest + Testing Library (frontend)

---

## Chunk 1: Backend — GET /api/v1/users

### Task 1: UsersService (TDD)

**Files:**
- Create: `backend/src/api/v1/users/users.service.ts`
- Create: `backend/src/api/v1/users/__tests__/users.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/api/v1/users/__tests__/users.service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSelect = vi.hoisted(() => vi.fn());
const mockKnex = vi.hoisted(() => vi.fn().mockReturnValue({ select: mockSelect }));

vi.mock('knex', () => ({ default: mockKnex }));

import { UsersService } from '../users.service';

describe('UsersService.list', () => {
  let service: UsersService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new UsersService(mockKnex as any);
  });

  it('queries users table for id, name, email', async () => {
    const rows = [
      { id: 'u1', name: 'Alice', email: 'alice@acme.com' },
      { id: 'u2', name: 'Bob', email: 'bob@acme.com' },
    ];
    mockSelect.mockResolvedValue(rows);

    const result = await service.list();

    expect(mockKnex).toHaveBeenCalledWith('users');
    expect(mockSelect).toHaveBeenCalledWith('id', 'name', 'email');
    expect(result).toEqual(rows);
  });

  it('returns empty array when no users exist', async () => {
    mockSelect.mockResolvedValue([]);
    const result = await service.list();
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend && npx vitest src/api/v1/users/__tests__/users.service.test.ts
```

Expected: FAIL — "Cannot find module '../users.service'"

- [ ] **Step 3: Implement UsersService**

Create `backend/src/api/v1/users/users.service.ts`:

```typescript
import { Injectable, Inject } from '@nestjs/common';
import type { Knex } from 'knex';

export interface TenantUserRow {
  id: string;
  name: string;
  email: string;
}

@Injectable()
export class UsersService {
  constructor(@Inject('KNEX_INSTANCE') private readonly knex: Knex) {}

  list(): Promise<TenantUserRow[]> {
    // RLS + QueryInterceptor scope this to the current tenant automatically.
    // Never add WHERE tenant_id manually — QueryInterceptor handles it.
    return this.knex<TenantUserRow>('users').select('id', 'name', 'email');
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd backend && npx vitest src/api/v1/users/__tests__/users.service.test.ts
```

Expected: 2 tests pass

---

### Task 2: UsersController + UsersModule + register in ApiV1Module

**Files:**
- Create: `backend/src/api/v1/users/users.controller.ts`
- Create: `backend/src/api/v1/users/users.module.ts`
- Modify: `backend/src/api/v1/api-v1.module.ts`

- [ ] **Step 1: Create UsersController**

Create `backend/src/api/v1/users/users.controller.ts`:

```typescript
import { Controller, Get } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('api/v1/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  list() {
    return this.usersService.list();
  }
}
```

- [ ] **Step 2: Create UsersModule**

Create `backend/src/api/v1/users/users.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 3: Register UsersModule in ApiV1Module**

Edit `backend/src/api/v1/api-v1.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ApiV1Controller } from './api-v1.controller';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [AuthModule, AdminModule, UsersModule],
  controllers: [ApiV1Controller],
})
export class ApiV1Module {}
```

- [ ] **Step 4: Run all backend tests — expect all pass**

```bash
cd backend && npm test
```

Expected: all tests pass (existing + 2 new UsersService tests)

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/api/v1/users/ src/api/v1/api-v1.module.ts
git commit -m "feat(users): add GET /api/v1/users endpoint for tenant user list"
```

---

## Chunk 2: Frontend — TenantUser type + api-client + EditCaseModal (TDD)

### Task 3: Add TenantUser type + getUsers to api-client

**Files:**
- Modify: `frontend/web/src/types/api.types.ts`
- Modify: `frontend/web/src/lib/api-client.ts`

- [ ] **Step 1: Add TenantUser type**

In `frontend/web/src/types/api.types.ts`, add after the `SupportCase` interface (after line 30):

```typescript
export interface TenantUser {
  id: string;
  name: string;
  email: string;
}
```

- [ ] **Step 2: Add getUsers to api-client**

In `frontend/web/src/lib/api-client.ts`:

1. Add `TenantUser` to the import at the top:

```typescript
import type {
  Customer,
  SupportCase,
  TenantUser,
  AnalyticsSummary,
  TrendPoint,
  AutomationTrigger,
  Campaign,
  PluginListResponse,
  PluginItemResponse,
  LoginResponse,
  RefreshResponse,
  ApiErrorBody,
} from '@/types/api.types';
```

2. Add `getUsers` method in the `crmApi` object, after `getCases`:

```typescript
  getUsers(ctx: AuthCtx): Promise<TenantUser[]> {
    return request('/api/v1/users', ctx);
  },
```

- [ ] **Step 3: Run frontend tests — expect still all pass (no regressions)**

```bash
cd frontend/web && npm test
```

Expected: 33 tests pass

---

### Task 4: Write failing EditCaseModal tests

**Files:**
- Create: `frontend/web/src/components/__tests__/edit-case-modal.test.tsx`

- [ ] **Step 1: Write test file**

Create `frontend/web/src/components/__tests__/edit-case-modal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { SupportCase } from '@/types/api.types';
import { EditCaseModal } from '../edit-case-modal';

// Vitest hoisting — MUST use vi.hoisted() for all variables referenced in vi.mock() factories
const mockMutateAsync = vi.hoisted(() => vi.fn());
const mockUseQuery = vi.hoisted(() =>
  vi.fn(() => ({
    data: [
      { id: 'u1', name: 'Alice', email: 'alice@acme.com' },
      { id: 'u2', name: 'Bob', email: 'bob@acme.com' },
    ],
    isLoading: false,
    isError: false,
  })),
);

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(() => ({ mutateAsync: mockMutateAsync, isPending: false })),
  useQuery: mockUseQuery,
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(() => ({ token: 'tok', tenantId: 'tid' })),
}));

vi.mock('@/lib/api-client', () => ({
  crmApi: { updateCase: vi.fn(), getUsers: vi.fn() },
}));

const baseCase: SupportCase = {
  id: 'case-1',
  tenant_id: 'tid',
  customer_id: 'c1',
  customer_name: 'Acme Corp',
  title: 'Login page crashes on Safari',
  description: 'Steps to reproduce...',
  status: 'in_progress',
  priority: 'high',
  assigned_to: 'u1',
  resolved_at: null,
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
};

const defaultProps = {
  supportCase: baseCase,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

describe('EditCaseModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders dialog with all fields pre-filled from supportCase', () => {
    render(<EditCaseModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toHaveValue('Login page crashes on Safari');
    expect(screen.getByLabelText(/description/i)).toHaveValue('Steps to reproduce...');
    expect(screen.getByLabelText(/status/i)).toHaveValue('in_progress');
    expect(screen.getByRole('button', { name: /high/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /low/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows "Title is required" when submitted with empty title', async () => {
    render(<EditCaseModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('calls mutateAsync with correct full payload on valid submit', async () => {
    mockMutateAsync.mockResolvedValue({});
    render(<EditCaseModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Updated title' } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'New desc' } });
    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: 'resolved' } });
    fireEvent.click(screen.getByRole('button', { name: /medium/i }));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        title: 'Updated title',
        description: 'New desc',
        status: 'resolved',
        priority: 'medium',
        assigned_to: 'u1',
      }),
    );
  });

  it('sends assigned_to: null (not missing key) when Unassigned is selected', async () => {
    mockMutateAsync.mockResolvedValue({});
    render(<EditCaseModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/assigned to/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ assigned_to: null }),
      ),
    );
  });

  it('calls onSuccess and onClose after successful submit', async () => {
    mockMutateAsync.mockResolvedValue({});
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<EditCaseModal supportCase={baseCase} onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows API error message when mutateAsync throws', async () => {
    mockMutateAsync.mockRejectedValue(new Error('server error'));
    render(<EditCaseModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByText(/failed to save/i)).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(<EditCaseModal supportCase={baseCase} onClose={onClose} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders all four status options', () => {
    render(<EditCaseModal {...defaultProps} />);
    const statusSelect = screen.getByLabelText(/status/i);
    expect(statusSelect).toContainElement(screen.getByRole('option', { name: /open/i }));
    expect(statusSelect).toContainElement(screen.getByRole('option', { name: /in progress/i }));
    expect(statusSelect).toContainElement(screen.getByRole('option', { name: /resolved/i }));
    expect(statusSelect).toContainElement(screen.getByRole('option', { name: /closed/i }));
  });

  it('renders user options in Assigned To dropdown', () => {
    render(<EditCaseModal {...defaultProps} />);
    expect(screen.getByRole('option', { name: /alice/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /bob/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /unassigned/i })).toBeInTheDocument();
  });

  it('shows "Loading users…" and disables select while users are loading', () => {
    mockUseQuery.mockReturnValueOnce({ data: undefined, isLoading: true, isError: false });
    render(<EditCaseModal {...defaultProps} />);
    const select = screen.getByLabelText(/assigned to/i);
    expect(select).toBeDisabled();
    expect(screen.getByRole('option', { name: /loading users/i })).toBeInTheDocument();
  });

  it('shows "Failed to load users" and disables select on users fetch error', () => {
    mockUseQuery.mockReturnValueOnce({ data: undefined, isLoading: false, isError: true });
    render(<EditCaseModal {...defaultProps} />);
    const select = screen.getByLabelText(/assigned to/i);
    expect(select).toBeDisabled();
    expect(screen.getByRole('option', { name: /failed to load users/i })).toBeInTheDocument();
  });

  it('resets form when supportCase.id changes', () => {
    const { rerender } = render(<EditCaseModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Dirty value' } });

    const newCase: SupportCase = { ...baseCase, id: 'case-2', title: 'Different case' };
    rerender(<EditCaseModal supportCase={newCase} onClose={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.getByLabelText(/title/i)).toHaveValue('Different case');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd frontend/web && npm test -- --reporter=verbose 2>&1 | grep -E "FAIL|Cannot find"
```

Expected: FAIL — "Cannot find module '../edit-case-modal'"

---

### Task 5: Implement EditCaseModal

**Files:**
- Create: `frontend/web/src/components/edit-case-modal.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/web/src/components/edit-case-modal.tsx`:

```tsx
'use client';

import { useState, useEffect } from 'react';
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

  // Reset form when a different case is opened
  useEffect(() => {
    setForm(caseToForm(supportCase));
    setTitleError('');
    setApiError('');
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
```

- [ ] **Step 2: Run tests — expect all pass**

```bash
cd frontend/web && npm test
```

Expected: all test files pass. New `edit-case-modal.test.tsx` should show 12 passing tests.

- [ ] **Step 3: Commit**

```bash
cd frontend/web && git add src/types/api.types.ts src/lib/api-client.ts src/components/edit-case-modal.tsx src/components/__tests__/edit-case-modal.test.tsx
git commit -m "feat(edit-case): add TenantUser type, getUsers api method, EditCaseModal component"
```

---

## Chunk 3: Wire Up — CasesList + cases/page.tsx

### Task 6: Update CasesList — add onEdit prop + tests

**Files:**
- Modify: `frontend/web/src/components/cases-list.tsx`
- Create: `frontend/web/src/components/__tests__/cases-list.test.tsx`

- [ ] **Step 1: Write failing CasesList tests**

Create `frontend/web/src/components/__tests__/cases-list.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SupportCase } from '@/types/api.types';
import { CasesList } from '../cases-list';

const supportCase: SupportCase = {
  id: 'case-1',
  tenant_id: 'tid',
  customer_id: 'c1',
  customer_name: 'Acme Corp',
  title: 'Login page crashes on Safari',
  description: null,
  status: 'open',
  priority: 'high',
  assigned_to: null,
  resolved_at: null,
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
};

describe('CasesList', () => {
  it('shows "No cases found" when list is empty', () => {
    render(<CasesList cases={[]} onEdit={vi.fn()} />);
    expect(screen.getByText(/no cases found/i)).toBeInTheDocument();
  });

  it('renders case title', () => {
    render(<CasesList cases={[supportCase]} onEdit={vi.fn()} />);
    expect(screen.getByText('Login page crashes on Safari')).toBeInTheDocument();
  });

  it('calls onEdit with the correct case when a card is clicked', () => {
    const onEdit = vi.fn();
    render(<CasesList cases={[supportCase]} onEdit={onEdit} />);
    fireEvent.click(screen.getByText('Login page crashes on Safari'));
    expect(onEdit).toHaveBeenCalledWith(supportCase);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd frontend/web && npx vitest src/components/__tests__/cases-list.test.tsx
```

Expected: FAIL — `CasesList` does not accept `onEdit` prop / click does nothing

- [ ] **Step 3: Update CasesList**

Replace the full content of `frontend/web/src/components/cases-list.tsx`:

```tsx
'use client';

import type { SupportCase } from '@/types/api.types';

const STATUS_STYLE: Record<SupportCase['status'], string> = {
  open: 'bg-sky-100 text-sky-700',
  in_progress: 'bg-amber-100 text-amber-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-slate-100 text-slate-600',
};

const PRIORITY_STYLE: Record<SupportCase['priority'], string> = {
  low: 'text-slate-500',
  medium: 'text-amber-600',
  high: 'text-red-600',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function CasesList({
  cases,
  onEdit,
}: {
  cases: SupportCase[];
  onEdit: (c: SupportCase) => void;
}) {
  if (cases.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">No cases found.</p>
    );
  }

  return (
    <div className="space-y-2">
      {cases.map((c) => (
        <div
          key={c.id}
          onClick={() => onEdit(c)}
          className="cursor-pointer rounded-lg border border-border bg-card p-4 hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm">{c.title}</p>
              {c.customer_name && (
                <p className="mt-0.5 text-xs text-muted-foreground">Customer: {c.customer_name}</p>
              )}
              {c.description && (
                <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{c.description}</p>
              )}
            </div>
            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[c.status]}`}>
                {c.status.replace('_', ' ')}
              </span>
              <span className={`text-xs font-medium ${PRIORITY_STYLE[c.priority]}`}>
                {c.priority}
              </span>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{formatDate(c.created_at)}</p>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run CasesList tests — expect pass**

```bash
cd frontend/web && npx vitest src/components/__tests__/cases-list.test.tsx
```

Expected: 3 tests pass

---

### Task 7: Wire cases/page.tsx + final verification

**Files:**
- Modify: `frontend/web/src/app/(crm)/cases/page.tsx`

- [ ] **Step 1: Update cases/page.tsx**

Replace the full content of `frontend/web/src/app/(crm)/cases/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import { CasesList } from '@/components/cases-list';
import { CreateCaseModal } from '@/components/create-case-modal';
import { EditCaseModal } from '@/components/edit-case-modal';
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
  const [editingCase, setEditingCase] = useState<SupportCase | null>(null);
  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const { data, isLoading, isError } = useQuery({
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
        ) : isError ? (
          <div className="flex h-64 items-center justify-center text-red-600">
            Failed to load cases.
          </div>
        ) : (
          <CasesList cases={filtered} onEdit={setEditingCase} />
        )}

        <CreateCaseModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSuccess={handleSuccess}
        />

        {editingCase && (
          <EditCaseModal
            supportCase={editingCase}
            onClose={() => setEditingCase(null)}
            onSuccess={handleSuccess}
          />
        )}
      </div>
    </PluginGate>
  );
}
```

- [ ] **Step 2: Run all frontend tests — expect all pass**

```bash
cd frontend/web && npm test
```

Expected: all 6 test files pass (45 tests: 33 original + 12 EditCaseModal + 3 CasesList - note: existing create-case-modal count stays at 11, giving 33 + 12 + 3 = 48 total including the new files)

- [ ] **Step 3: Commit**

```bash
git add frontend/web/src/components/cases-list.tsx \
        frontend/web/src/components/__tests__/cases-list.test.tsx \
        frontend/web/src/app/\(crm\)/cases/page.tsx
git commit -m "feat(cases): wire EditCaseModal — click card to edit, CasesList onEdit prop"
```
