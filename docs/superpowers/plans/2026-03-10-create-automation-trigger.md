# Create Automation Trigger Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 2-step wizard modal to the automation page that lets users create automation triggers with name, event type, active state, and optional AND-logic conditions.

**Architecture:** New `CreateTriggerModal` component handles all wizard state internally (step 1: basic info; step 2: condition builder). `AutomationPage` gains a `+ Add Trigger` button and renders the modal. `crmApi.createTrigger` already exists in `api-client.ts`.

**Tech Stack:** Next.js 15, React 19, TanStack Query v5 (`useMutation`), Tailwind CSS, Vitest + Testing Library, nanoid (uuid alternative for condition row keys — use `crypto.randomUUID()` available in all modern browsers, no extra dep needed).

---

## Chunk 1: Modify automation page

### Task 1: Add "+ Add Trigger" button and modal state to `automation/page.tsx`

**Files:**
- Modify: `frontend/web/src/app/(crm)/automation/page.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/web/src/app/(crm)/automation/__tests__/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AutomationPage from '../page';

const mockRefetch = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(() => ({
    data: { count: 2, data: [] },
    isLoading: false,
    isError: false,
    refetch: mockRefetch,
  })),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(() => ({ token: 'tok', tenantId: 'tid' })),
}));

vi.mock('@/lib/api-client', () => ({
  crmApi: { getTriggers: vi.fn(), getEnabledPlugins: vi.fn() },
}));

vi.mock('@/components/triggers-list', () => ({
  TriggersList: () => <div data-testid="triggers-list" />,
}));

vi.mock('@/components/plugin-gate', () => ({
  PluginGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/create-trigger-modal', () => ({
  CreateTriggerModal: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? <div role="dialog" data-testid="create-trigger-modal"><button onClick={onClose}>Close</button></div> : null,
}));

describe('AutomationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders "+ Add Trigger" button', () => {
    render(<AutomationPage />);
    expect(screen.getByRole('button', { name: /add trigger/i })).toBeInTheDocument();
  });

  it('opens CreateTriggerModal when button is clicked', () => {
    render(<AutomationPage />);
    expect(screen.queryByTestId('create-trigger-modal')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /add trigger/i }));
    expect(screen.getByTestId('create-trigger-modal')).toBeInTheDocument();
  });

  it('closes modal when onClose is called', () => {
    render(<AutomationPage />);
    fireEvent.click(screen.getByRole('button', { name: /add trigger/i }));
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByTestId('create-trigger-modal')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend/web && npx vitest run src/app/\(crm\)/automation/__tests__/page.test.tsx
```

Expected: FAIL — `Cannot find module '@/components/create-trigger-modal'`

- [ ] **Step 3: Create stub `create-trigger-modal.tsx` so the TypeScript import resolves**

Create `frontend/web/src/components/create-trigger-modal.tsx` with minimal export (full implementation in Task 2):

```tsx
'use client';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateTriggerModal({ open, onClose, onSuccess: _onSuccess }: Props) {
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="New Automation Trigger">
      <button type="button" onClick={onClose}>Close</button>
    </div>
  );
}
```

- [ ] **Step 4: Implement the changes in `automation/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import { TriggersList } from '@/components/triggers-list';
import { PluginGate } from '@/components/plugin-gate';
import { CreateTriggerModal } from '@/components/create-trigger-modal';

export default function AutomationPage() {
  const { token, tenantId } = useAuthStore();
  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };
  const [modalOpen, setModalOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['triggers', tenantId],
    queryFn: () => crmApi.getTriggers(ctx),
    enabled: Boolean(token && tenantId),
  });

  return (
    <PluginGate plugin="automation" pluginLabel="Automation">
      <div>
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Automation</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {data ? `${data.count} triggers` : 'Manage automation triggers'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            + Add Trigger
          </button>
        </div>

        {isLoading ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            Loading…
          </div>
        ) : isError ? (
          <div className="flex h-64 items-center justify-center text-red-600">
            Failed to load triggers.
          </div>
        ) : (
          <TriggersList triggers={data?.data ?? []} />
        )}

        <CreateTriggerModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSuccess={() => { void refetch(); }}
        />
      </div>
    </PluginGate>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd frontend/web && npx vitest run src/app/\(crm\)/automation/__tests__/page.test.tsx
```

Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
cd frontend/web && git add src/app/\(crm\)/automation/__tests__/page.test.tsx src/app/\(crm\)/automation/page.tsx src/components/create-trigger-modal.tsx
git commit -m "feat(automation): add + Add Trigger button and stub modal to automation page"
```

---

## Chunk 2: Create the wizard modal

### Task 2: Implement `create-trigger-modal.tsx` — Step 1 (Basic Info)

**Files:**
- Modify: `frontend/web/src/components/create-trigger-modal.tsx`
- Create: `frontend/web/src/components/__tests__/create-trigger-modal.test.tsx`

- [ ] **Step 1: Write failing tests for Step 1 behavior**

Create `frontend/web/src/components/__tests__/create-trigger-modal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateTriggerModal } from '../create-trigger-modal';

const mockMutateAsync = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(() => ({ mutateAsync: mockMutateAsync, isPending: false })),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(() => ({ token: 'tok', tenantId: 'tid' })),
}));

vi.mock('@/lib/api-client', () => ({
  crmApi: { createTrigger: vi.fn() },
}));

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

describe('CreateTriggerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Visibility ──────────────────────────────────────────────────────────────
  it('renders nothing when open=false', () => {
    render(<CreateTriggerModal {...defaultProps} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders dialog when open=true', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  // ── Step 1 fields ───────────────────────────────────────────────────────────
  it('shows step 1 fields by default', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    expect(screen.getByLabelText(/trigger name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/event type/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });

  it('"Next" button is disabled when name is empty', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('"Next" button is enabled when name is filled', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled();
  });

  it('active toggle defaults to ON', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    expect(screen.getByRole('switch', { name: /active when created/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('active toggle can be turned off', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('switch', { name: /active when created/i }));
    expect(screen.getByRole('switch', { name: /active when created/i })).toHaveAttribute('aria-checked', 'false');
  });

  it('event type dropdown has customer.create option', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    expect(screen.getByRole('option', { name: 'customer.create' })).toBeInTheDocument();
  });

  // ── Step navigation ─────────────────────────────────────────────────────────
  it('advances to step 2 when Next is clicked with a name', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByRole('button', { name: /create trigger/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument();
  });

  it('"Back" button returns to step 1', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });

  // ── Step 2 condition builder ─────────────────────────────────────────────────
  it('step 2 starts with no condition rows', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.queryByLabelText(/attribute/i)).not.toBeInTheDocument();
  });

  it('"+ Add condition" adds a condition row', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /add condition/i }));
    expect(screen.getAllByLabelText(/attribute/i)).toHaveLength(1);
  });

  it('remove button deletes a condition row', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /add condition/i }));
    fireEvent.click(screen.getByRole('button', { name: /remove condition/i }));
    expect(screen.queryByLabelText(/attribute/i)).not.toBeInTheDocument();
  });

  it('AND badge appears between two condition rows', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /add condition/i }));
    fireEvent.click(screen.getByRole('button', { name: /add condition/i }));
    expect(screen.getByText('AND')).toBeInTheDocument();
  });

  it('value input is hidden for is_empty operator', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /add condition/i }));
    fireEvent.change(screen.getByLabelText(/operator/i), { target: { value: 'is_empty' } });
    expect(screen.queryByLabelText(/value/i)).not.toBeInTheDocument();
  });

  // ── Submission ──────────────────────────────────────────────────────────────
  it('submits with empty conditions as {}', async () => {
    mockMutateAsync.mockResolvedValue({});
    render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /create trigger/i }));
    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'My Trigger', conditions: {}, actions: [] }),
      ),
    );
  });

  it('submits with AND conditions when rows are filled', async () => {
    mockMutateAsync.mockResolvedValue({});
    render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /add condition/i }));
    fireEvent.change(screen.getByLabelText(/attribute/i), { target: { value: 'company' } });
    fireEvent.change(screen.getByLabelText(/operator/i), { target: { value: 'equals' } });
    fireEvent.change(screen.getByLabelText(/value/i), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: /create trigger/i }));
    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          conditions: { and: [{ field: 'company', op: 'equals', value: 'Acme' }] },
        }),
      ),
    );
  });

  it('does not submit if a condition row is missing a value', async () => {
    render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /add condition/i }));
    // leave value empty
    fireEvent.click(screen.getByRole('button', { name: /create trigger/i }));
    expect(await screen.findByText(/value is required/i)).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('calls onSuccess and onClose after successful submit', async () => {
    mockMutateAsync.mockResolvedValue({});
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<CreateTriggerModal open={true} onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /create trigger/i }));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows API error when mutateAsync throws', async () => {
    mockMutateAsync.mockRejectedValue(new Error('Server error'));
    render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /create trigger/i }));
    expect(await screen.findByText(/failed to create trigger/i)).toBeInTheDocument();
  });

  it('calls onClose when × is clicked', () => {
    const onClose = vi.fn();
    render(<CreateTriggerModal open={true} onClose={onClose} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('resets to step 1 when modal is reopened', () => {
    const { rerender } = render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    // close then reopen
    rerender(<CreateTriggerModal {...defaultProps} open={false} />);
    rerender(<CreateTriggerModal {...defaultProps} open={true} />);
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/trigger name/i)).toHaveValue('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend/web && npx vitest run src/components/__tests__/create-trigger-modal.test.tsx
```

Expected: FAIL — tests fail because the stub implementation doesn't have the full wizard UI.

- [ ] **Step 3: Implement `create-trigger-modal.tsx`**

Replace the file content entirely:

```tsx
'use client';

import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';

// ── Constants ──────────────────────────────────────────────────────────────────

const EVENT_TYPES = ['customer.create'];
const ATTRIBUTES = ['name', 'email', 'phone', 'company'];
const OPERATORS = [
  { value: 'equals',       label: 'equals',       needsValue: true },
  { value: 'not_equals',   label: 'not equals',   needsValue: true },
  { value: 'contains',     label: 'contains',     needsValue: true },
  { value: 'starts_with',  label: 'starts with',  needsValue: true },
  { value: 'is_empty',     label: 'is empty',     needsValue: false },
  { value: 'is_not_empty', label: 'is not empty', needsValue: false },
];

// ── Types ──────────────────────────────────────────────────────────────────────

type Step = 1 | 2;

interface ConditionRow {
  id: string;
  field: string;
  op: string;
  value: string;
}

interface FormState {
  name: string;
  eventType: string;
  isActive: boolean;
  conditions: ConditionRow[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeRow(): ConditionRow {
  return { id: crypto.randomUUID(), field: ATTRIBUTES[0], op: OPERATORS[0].value, value: '' };
}

function operatorNeedsValue(op: string): boolean {
  return OPERATORS.find((o) => o.value === op)?.needsValue ?? true;
}

const EMPTY_FORM: FormState = {
  name: '',
  eventType: EVENT_TYPES[0],
  isActive: true,
  conditions: [],
};

// ── Component ──────────────────────────────────────────────────────────────────

export function CreateTriggerModal({ open, onClose, onSuccess }: Props) {
  const { token, tenantId } = useAuthStore();
  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [conditionErrors, setConditionErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState('');

  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof crmApi.createTrigger>[0]) =>
      crmApi.createTrigger(input, ctx),
  });

  // Reset on close
  useEffect(() => {
    if (!open) {
      setStep(1);
      setForm(EMPTY_FORM);
      setConditionErrors({});
      setApiError('');
    }
  }, [open]);

  if (!open) return null;

  function handleClose() {
    setStep(1);
    setForm(EMPTY_FORM);
    setConditionErrors({});
    setApiError('');
    onClose();
  }

  function addCondition() {
    setForm((prev) => ({ ...prev, conditions: [...prev.conditions, makeRow()] }));
  }

  function removeCondition(id: string) {
    setForm((prev) => ({ ...prev, conditions: prev.conditions.filter((r) => r.id !== id) }));
    setConditionErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function updateCondition(id: string, patch: Partial<Omit<ConditionRow, 'id'>>) {
    setForm((prev) => ({
      ...prev,
      conditions: prev.conditions.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
    if (patch.value !== undefined || patch.op !== undefined) {
      setConditionErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }

  function validateConditions(): boolean {
    const errors: Record<string, string> = {};
    for (const row of form.conditions) {
      if (operatorNeedsValue(row.op) && !row.value.trim()) {
        errors[row.id] = 'Value is required';
      }
    }
    setConditionErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit() {
    setApiError('');
    if (!validateConditions()) return;

    const payload = {
      name: form.name.trim(),
      event_type: form.eventType,
      is_active: form.isActive,
      conditions:
        form.conditions.length > 0
          ? { and: form.conditions.map((r) => ({ field: r.field, op: r.op, value: r.value })) }
          : {},
      actions: [] as unknown[],
    };

    try {
      await mutation.mutateAsync(payload);
      setForm(EMPTY_FORM);
      onSuccess();
      onClose();
    } catch {
      setApiError('Failed to create trigger. Please try again.');
    }
  }

  // ── Step indicator ─────────────────────────────────────────────────────────
  const StepIndicator = (
    <div className="flex items-center gap-2 mb-5">
      <div
        className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
          step === 1 ? 'bg-primary text-primary-foreground' : 'bg-green-500 text-white'
        }`}
      >
        {step === 1 ? '1' : '✓'}
      </div>
      <div className={`h-0.5 flex-1 ${step === 2 ? 'bg-green-500' : 'bg-border'}`} />
      <div
        className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
          step === 2 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
        }`}
      >
        2
      </div>
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New Automation Trigger"
        className="w-full max-w-md rounded-lg bg-card shadow-xl border border-border"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold">New Automation Trigger</h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5">
          {StepIndicator}

          {/* ── Step 1 ─────────────────────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              {/* Trigger Name */}
              <div>
                <label htmlFor="trigger-name" className="mb-1.5 block text-sm font-medium">
                  Trigger Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="trigger-name"
                  aria-label="Trigger Name"
                  type="text"
                  maxLength={100}
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. Welcome new enterprise customer"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {/* Event Type */}
              <div>
                <label htmlFor="trigger-event" className="mb-1.5 block text-sm font-medium">
                  Event Type <span className="text-red-500">*</span>
                </label>
                <select
                  id="trigger-event"
                  aria-label="Event Type"
                  value={form.eventType}
                  onChange={(e) => setForm((prev) => ({ ...prev, eventType: e.target.value }))}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {EVENT_TYPES.map((et) => (
                    <option key={et} value={et}>{et}</option>
                  ))}
                </select>
              </div>

              {/* Active toggle */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium">Active when created</span>
                <button
                  type="button"
                  role="switch"
                  aria-label="Active when created"
                  aria-checked={form.isActive}
                  onClick={() => setForm((prev) => ({ ...prev, isActive: !prev.isActive }))}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
                    form.isActive ? 'bg-green-500' : 'bg-muted'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      form.isActive ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
                <span className={`text-sm ${form.isActive ? 'text-green-600' : 'text-muted-foreground'}`}>
                  {form.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          )}

          {/* ── Step 2 ─────────────────────────────────────────────────────── */}
          {step === 2 && (
            <div>
              <p className="mb-3 text-sm font-medium">
                Conditions{' '}
                <span className="font-normal text-muted-foreground">(optional — leave empty to fire on every event)</span>
              </p>

              {/* Condition rows */}
              {form.conditions.map((row, idx) => (
                <div key={row.id}>
                  {/* AND badge between rows */}
                  {idx > 0 && (
                    <div className="my-2 text-center">
                      <span className="rounded border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        AND
                      </span>
                    </div>
                  )}
                  <div className="flex items-start gap-2">
                    <div className="flex flex-1 gap-2">
                      {/* Attribute */}
                      <select
                        aria-label="Attribute"
                        value={row.field}
                        onChange={(e) => updateCondition(row.id, { field: e.target.value })}
                        className="flex-[2] rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        {ATTRIBUTES.map((a) => (
                          <option key={a} value={a}>{a}</option>
                        ))}
                      </select>

                      {/* Operator */}
                      <select
                        aria-label="Operator"
                        value={row.op}
                        onChange={(e) => updateCondition(row.id, { op: e.target.value, value: '' })}
                        className="flex-[2] rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        {OPERATORS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>

                      {/* Value */}
                      {operatorNeedsValue(row.op) && (
                        <div className="flex-[3]">
                          <input
                            aria-label="Value"
                            type="text"
                            value={row.value}
                            onChange={(e) => updateCondition(row.id, { value: e.target.value })}
                            placeholder="Value…"
                            className={`w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                              conditionErrors[row.id] ? 'border-red-500' : 'border-border'
                            }`}
                          />
                          {conditionErrors[row.id] && (
                            <p className="mt-0.5 text-xs text-red-500">{conditionErrors[row.id]}</p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Remove */}
                    <button
                      type="button"
                      aria-label="Remove condition"
                      onClick={() => removeCondition(row.id)}
                      className="mt-1.5 text-red-500 hover:text-red-700"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}

              {/* Add condition */}
              <button
                type="button"
                onClick={addCondition}
                className="mt-3 flex items-center gap-1 text-sm text-primary hover:underline"
              >
                + Add condition
              </button>

              {/* API error */}
              {apiError && (
                <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{apiError}</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between border-t border-border px-6 py-4">
          {step === 1 ? (
            <>
              <div />
              <button
                type="button"
                disabled={!form.name.trim()}
                onClick={() => setStep(2)}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Next →
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                ← Back
              </button>
              <button
                type="button"
                disabled={mutation.isPending}
                onClick={handleSubmit}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {mutation.isPending ? 'Creating…' : 'Create Trigger'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd frontend/web && npx vitest run src/components/__tests__/create-trigger-modal.test.tsx
```

Expected: PASS (all tests green)

- [ ] **Step 5: Also run the page test to verify no regression**

```bash
cd frontend/web && npx vitest run src/app/\(crm\)/automation/__tests__/page.test.tsx
```

Expected: PASS

- [ ] **Step 6: Run full frontend test suite**

```bash
cd frontend/web && npx vitest run
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/web/src/components/create-trigger-modal.tsx \
        frontend/web/src/components/__tests__/create-trigger-modal.test.tsx
git commit -m "feat(automation): implement CreateTriggerModal 2-step wizard"
```

---

## Verification

After both tasks are committed, do a final smoke check:

- [ ] `cd frontend/web && npx vitest run` — all tests green
- [ ] If Docker is running: open `http://localhost:3002`, go to Automation, click "+ Add Trigger", complete both steps, verify trigger appears in list.
