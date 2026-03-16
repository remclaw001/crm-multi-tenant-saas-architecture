# Variable Picker for Template String Inputs — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace plain text inputs for `template-string` action params with a `TemplateStringInput` component that lets users insert `{{objectKey.field}}` variables via a click-to-insert popover.

**Architecture:** Two new components (`VariablePickerPopover` + `TemplateStringInput`) built bottom-up with TDD. `ActionsStep` gets two new props (`eventType`, `eventFields`) and swaps `<input>` for `<TemplateStringInput>` on `template-string` params. `CreateTriggerModal` passes the already-computed `selectedEventFields` and `form.eventType` down.

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library (jsdom), Tailwind CSS.

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `frontend/web/src/components/automation/variable-picker-popover.tsx` | **New** | Presentational: field grid, calls `onInsert` |
| `frontend/web/src/components/automation/template-string-input.tsx` | **New** | Input + `{}` button + mounts popover, manages cursor insert |
| `frontend/web/src/components/automation/__tests__/variable-picker-popover.test.tsx` | **New** | Unit tests for popover |
| `frontend/web/src/components/automation/__tests__/template-string-input.test.tsx` | **New** | Unit tests for input wrapper |
| `frontend/web/src/components/automation/__tests__/actions-step.test.tsx` | **New** | Unit tests for ActionsStep with new props |
| `frontend/web/src/components/automation/actions-step.tsx` | **Modify** | Add `eventType`/`eventFields` props; swap render branch |
| `frontend/web/src/components/create-trigger-modal.tsx` | **Modify** | Pass `eventType` + `eventFields` to `<ActionsStep>` |
| `frontend/web/src/components/__tests__/create-trigger-modal.test.tsx` | **Modify** | Add `useQuery` to mock; update step-3 navigation |

All commands run from `frontend/web/`.

---

## Chunk 1: VariablePickerPopover

### Task 1: VariablePickerPopover — TDD

**Files:**
- Create: `src/components/automation/__tests__/variable-picker-popover.test.tsx`
- Create: `src/components/automation/variable-picker-popover.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/automation/__tests__/variable-picker-popover.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VariablePickerPopover } from '../variable-picker-popover';

const FIELDS = [
  { name: 'name',    type: 'string' as const },
  { name: 'email',   type: 'string' as const },
  { name: 'phone',   type: 'string' as const },
];

describe('VariablePickerPopover', () => {
  it('renders all field names', () => {
    render(
      <VariablePickerPopover
        fields={FIELDS}
        objectKey="customer"
        onInsert={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('name')).toBeInTheDocument();
    expect(screen.getByText('email')).toBeInTheDocument();
    expect(screen.getByText('phone')).toBeInTheDocument();
  });

  it('renders field types', () => {
    render(
      <VariablePickerPopover
        fields={FIELDS}
        objectKey="customer"
        onInsert={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // each field shows its type; there are 3 "string" labels
    expect(screen.getAllByText('string')).toHaveLength(3);
  });

  it('renders objectKey as header label', () => {
    render(
      <VariablePickerPopover
        fields={FIELDS}
        objectKey="customer"
        onInsert={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/customer/i)).toBeInTheDocument();
  });

  it('calls onInsert with correct variable string on field click', () => {
    const onInsert = vi.fn();
    render(
      <VariablePickerPopover
        fields={FIELDS}
        objectKey="customer"
        onInsert={onInsert}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /name/i }));
    expect(onInsert).toHaveBeenCalledWith('{{customer.name}}');
  });

  it('calls onClose after insert', () => {
    const onClose = vi.fn();
    render(
      <VariablePickerPopover
        fields={FIELDS}
        objectKey="customer"
        onInsert={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /email/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('uses objectKey from props in inserted variable', () => {
    const onInsert = vi.fn();
    render(
      <VariablePickerPopover
        fields={[{ name: 'status', type: 'string' }]}
        objectKey="deal"
        onInsert={onInsert}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /status/i }));
    expect(onInsert).toHaveBeenCalledWith('{{deal.status}}');
  });

  it('does not render a back arrow (level-1 not implemented)', () => {
    render(
      <VariablePickerPopover
        fields={FIELDS}
        objectKey="customer"
        onInsert={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
npx vitest run src/components/automation/__tests__/variable-picker-popover.test.tsx
```

Expected: all 7 tests fail with `Cannot find module '../variable-picker-popover'`.

- [ ] **Step 3: Implement `VariablePickerPopover`**

Create `src/components/automation/variable-picker-popover.tsx`:

```tsx
'use client';

import type { EventField } from '@/types/api.types';

interface Props {
  fields:    EventField[];
  objectKey: string;
  onInsert:  (variable: string) => void;
  onClose:   () => void;
}

export function VariablePickerPopover({ fields, objectKey, onInsert, onClose }: Props) {
  function handleFieldClick(field: EventField) {
    onInsert(`{{${objectKey}.${field.name}}}`);
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-label="Insert variable"
      className="absolute right-0 top-full z-50 mt-1 w-52 rounded-md border border-border bg-card shadow-lg"
    >
      <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {objectKey}
      </div>
      <div className="grid grid-cols-2 gap-1 p-2">
        {fields.map((field) => (
          <button
            key={field.name}
            type="button"
            aria-label={field.name}
            onClick={() => handleFieldClick(field)}
            className="rounded p-2 text-left text-sm hover:bg-accent"
          >
            <div className="font-medium">{field.name}</div>
            <div className="text-xs text-muted-foreground">{field.type}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests — confirm all 7 pass**

```bash
npx vitest run src/components/automation/__tests__/variable-picker-popover.test.tsx
```

Expected: `Tests  7 passed (7)`.

> **Note:** The `it('calls onInsert...', ...)` test uses `{ name: /name/i }` to target the "name" field button. Verify no other element on the page has a matching label.

- [ ] **Step 5: Commit**

```bash
git add src/components/automation/variable-picker-popover.tsx \
        src/components/automation/__tests__/variable-picker-popover.test.tsx
git commit -m "feat(automation): add VariablePickerPopover component (TDD)"
```

---

## Chunk 2: TemplateStringInput

### Task 2: TemplateStringInput — TDD

**Files:**
- Create: `src/components/automation/__tests__/template-string-input.test.tsx`
- Create: `src/components/automation/template-string-input.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/automation/__tests__/template-string-input.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TemplateStringInput } from '../template-string-input';
import type { EventField } from '@/types/api.types';

const FIELDS: EventField[] = [
  { name: 'name',  type: 'string' },
  { name: 'email', type: 'string' },
];

describe('TemplateStringInput', () => {
  // ── Rendering ──────────────────────────────────────────────────────────────

  it('renders an input with the given aria-label', () => {
    render(
      <TemplateStringInput
        value=""
        onChange={vi.fn()}
        aria-label="Body"
        eventFields={FIELDS}
        objectKey="customer"
      />,
    );
    expect(screen.getByRole('textbox', { name: /body/i })).toBeInTheDocument();
  });

  it('shows {} button when eventFields is non-empty', () => {
    render(
      <TemplateStringInput
        value=""
        onChange={vi.fn()}
        eventFields={FIELDS}
        objectKey="customer"
      />,
    );
    expect(screen.getByRole('button', { name: /insert variable/i })).toBeInTheDocument();
  });

  it('hides {} button when eventFields is empty', () => {
    render(
      <TemplateStringInput
        value=""
        onChange={vi.fn()}
        eventFields={[]}
        objectKey="customer"
      />,
    );
    expect(screen.queryByRole('button', { name: /insert variable/i })).not.toBeInTheDocument();
  });

  // ── Popover open / close ───────────────────────────────────────────────────

  it('opens the picker popover when {} button is clicked', () => {
    render(
      <TemplateStringInput
        value=""
        onChange={vi.fn()}
        eventFields={FIELDS}
        objectKey="customer"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /insert variable/i }));
    // VariablePickerPopover renders a dialog
    expect(screen.getByRole('dialog', { name: /insert variable/i })).toBeInTheDocument();
  });

  it('closes popover when Escape is pressed on the input', () => {
    render(
      <TemplateStringInput
        value=""
        onChange={vi.fn()}
        eventFields={FIELDS}
        objectKey="customer"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /insert variable/i }));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // ── Variable insertion ─────────────────────────────────────────────────────

  it('calls onChange with variable appended when selectionStart is null (jsdom default for unfocused input)', () => {
    // jsdom returns null for selectionStart on an input that has never been focused
    const onChange = vi.fn();
    render(
      <TemplateStringInput
        value="hello "
        onChange={onChange}
        eventFields={FIELDS}
        objectKey="customer"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /insert variable/i }));
    fireEvent.click(screen.getByRole('button', { name: 'name' }));
    expect(onChange).toHaveBeenCalledWith('hello {{customer.name}}');
  });

  it('propagates typed changes via onChange', () => {
    const onChange = vi.fn();
    render(
      <TemplateStringInput
        value=""
        onChange={onChange}
        eventFields={FIELDS}
        objectKey="customer"
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abc' } });
    expect(onChange).toHaveBeenCalledWith('abc');
  });

  it('passes placeholder to the input', () => {
    render(
      <TemplateStringInput
        value=""
        onChange={vi.fn()}
        placeholder='{"name": "…"}'
        eventFields={FIELDS}
        objectKey="customer"
      />,
    );
    expect(screen.getByPlaceholderText('{"name": "…"}')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
npx vitest run src/components/automation/__tests__/template-string-input.test.tsx
```

Expected: all 8 tests fail with `Cannot find module '../template-string-input'`.

- [ ] **Step 3: Implement `TemplateStringInput`**

Create `src/components/automation/template-string-input.tsx`:

```tsx
'use client';

import { useState, useRef, useEffect } from 'react';
import { VariablePickerPopover } from './variable-picker-popover';
import type { EventField } from '@/types/api.types';

interface Props {
  value:         string;
  onChange:      (value: string) => void;
  placeholder?:  string;
  disabled?:     boolean;
  'aria-label'?: string;
  className?:    string;
  eventFields:   EventField[];
  objectKey:     string;
}

export function TemplateStringInput({
  value,
  onChange,
  placeholder,
  disabled,
  'aria-label': ariaLabel,
  className,
  eventFields,
  objectKey,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const inputRef   = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Snapshot cursor position at the moment {} is clicked (before blur shifts focus)
  const selectionRef = useRef<{ start: number | null; end: number | null }>({
    start: null,
    end:   null,
  });

  const hasFields = eventFields.length > 0;

  // Close on click outside the wrapper
  useEffect(() => {
    if (!pickerOpen) return;
    function handleMouseDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [pickerOpen]);

  function handlePickerButtonMouseDown(e: React.MouseEvent) {
    // Capture selectionStart BEFORE the input loses focus due to button click
    selectionRef.current = {
      start: inputRef.current?.selectionStart ?? null,
      end:   inputRef.current?.selectionEnd   ?? null,
    };
    // Prevent default so the input does NOT blur (keeps selection intact for capture)
    e.preventDefault();
  }

  function handlePickerButtonClick() {
    setPickerOpen((prev) => !prev);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && pickerOpen) {
      setPickerOpen(false);
      inputRef.current?.focus();
    }
  }

  function handleInsert(variable: string) {
    const { start, end } = selectionRef.current;
    let newValue: string;
    if (start === null) {
      // Fallback: append to end
      newValue = value + variable;
    } else {
      const s  = start;
      const e2 = end ?? s;
      newValue = value.slice(0, s) + variable + value.slice(e2);
    }
    onChange(newValue);
    setPickerOpen(false);
    // Restore focus and place cursor immediately after the inserted token
    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        const newPos = (start ?? value.length) + variable.length;
        inputRef.current.setSelectionRange(newPos, newPos);
      }
    });
  }

  return (
    <div ref={wrapperRef} className={`relative ${className ?? ''}`}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        style={hasFields ? { paddingRight: '2.25rem' } : undefined}
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {hasFields && (
        <button
          type="button"
          aria-label="Insert variable"
          onMouseDown={handlePickerButtonMouseDown}
          onClick={handlePickerButtonClick}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded bg-accent px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:bg-primary hover:text-primary-foreground"
        >
          {'{}'}
        </button>
      )}
      {pickerOpen && (
        <VariablePickerPopover
          fields={eventFields}
          objectKey={objectKey}
          onInsert={handleInsert}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests — confirm all 8 pass**

```bash
npx vitest run src/components/automation/__tests__/template-string-input.test.tsx
```

Expected: `Tests  8 passed (8)`.

- [ ] **Step 5: Commit**

```bash
git add src/components/automation/template-string-input.tsx \
        src/components/automation/__tests__/template-string-input.test.tsx
git commit -m "feat(automation): add TemplateStringInput component (TDD)"
```

---

## Chunk 3: Wire into ActionsStep and CreateTriggerModal

### Task 3: Update ActionsStep

**Files:**
- Create: `src/components/automation/__tests__/actions-step.test.tsx`
- Modify: `src/components/automation/actions-step.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/automation/__tests__/actions-step.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActionsStep } from '../actions-step';
import type { ActionDefinition } from '@/types/api.types';

// Mock TanStack Query — returns a catalog with one template-string param and one string param
const mockUseQuery = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-query', () => ({
  useQuery: mockUseQuery,
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(() => ({ token: 'tok', tenantId: 'tid' })),
}));

vi.mock('@/lib/api-client', () => ({
  crmApi: { getAvailableActions: vi.fn() },
}));

const CATALOG: ActionDefinition[] = [
  {
    type: 'case.create',
    label: 'Create Support Case',
    description: 'Open a case',
    requiredPlugins: [],
    params: [
      { name: 'title',       label: 'Title',       type: 'template-string', required: true,  hint: '{{customer.name}}' },
      { name: 'description', label: 'Description', type: 'template-string', required: false, hint: '{{customer.email}}' },
      { name: 'priority',    label: 'Priority',    type: 'enum',            required: true,
        options: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }] },
    ],
  },
];

const EVENT_FIELDS = [
  { name: 'name',  type: 'string' as const },
  { name: 'email', type: 'string' as const },
];

const BASE_PROPS = {
  actions:     [{ type: 'case.create', params: { title: '', description: '', priority: 'low' } }],
  onChange:    vi.fn(),
  eventType:   'customer.create',
  eventFields: EVENT_FIELDS,
};

describe('ActionsStep', () => {
  beforeEach(() => {
    mockUseQuery.mockReturnValue({ data: { data: CATALOG }, isLoading: false, isError: false });
  });

  it('renders a TemplateStringInput (with {} button) for template-string params', () => {
    render(<ActionsStep {...BASE_PROPS} />);
    // Both 'title' and 'description' are template-string params → 2 {} buttons
    expect(screen.getAllByRole('button', { name: /insert variable/i })).toHaveLength(2);
  });

  it('renders a plain input for string/url params and select for enum params', () => {
    render(<ActionsStep {...BASE_PROPS} />);
    // Priority is enum → select; no extra plain input for template params
    expect(screen.getByRole('combobox', { name: /priority/i })).toBeInTheDocument();
  });

  it('hides {} button when eventFields is empty', () => {
    render(<ActionsStep {...BASE_PROPS} eventFields={[]} />);
    expect(screen.queryByRole('button', { name: /insert variable/i })).not.toBeInTheDocument();
  });

  it('passes objectKey derived from eventType to TemplateStringInput', () => {
    render(<ActionsStep {...BASE_PROPS} />);
    // Open the picker on the title field
    const [titlePicker] = screen.getAllByRole('button', { name: /insert variable/i });
    titlePicker.click();
    // The popover should show 'name' field under 'customer' header
    expect(screen.getByText(/customer/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'name' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
npx vitest run src/components/automation/__tests__/actions-step.test.tsx
```

Expected: all 4 tests fail (TypeScript error: `eventType`/`eventFields` props don't exist yet on `ActionsStep`).

- [ ] **Step 3: Update `ActionsStep`**

Open `src/components/automation/actions-step.tsx`. Apply these changes:

**a) Add imports:**

Add `TemplateStringInput` import at the top of the file:
```tsx
import { TemplateStringInput } from './template-string-input';
```

And merge `EventField` into the existing `@/types/api.types` import (line 7). Current:
```tsx
import type { ActionDefinition, StoredAction } from '@/types/api.types';
```
Replace with:
```tsx
import type { ActionDefinition, StoredAction, EventField } from '@/types/api.types';
```

**b) Update the `Props` interface** (lines 9–12):
```tsx
interface Props {
  actions:     StoredAction[];
  onChange:    (actions: StoredAction[]) => void;
  eventType:   string;
  eventFields: EventField[];
}
```

**c) Destructure the new props** in the function signature (line 22):
```tsx
export function ActionsStep({ actions, onChange, eventType, eventFields }: Props) {
```

**d) Derive `objectKey`** — add this line immediately after the existing `const catalog` line (after line 31):
```tsx
const objectKey = eventType.split('.')[0];
```

**e) Update the param render branch** — find the `else` branch that renders `<input>` for non-enum params (currently around line 102–110) and replace it:

Current:
```tsx
) : (
  <input
    aria-label={paramDef.label}
    type="text"
    value={(action.params[paramDef.name] as string) ?? ''}
    onChange={(e) => updateParam(index, paramDef.name, e.target.value)}
    placeholder={paramDef.hint ?? ''}
    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
  />
```

Replace with:
```tsx
) : paramDef.type === 'template-string' ? (
  <TemplateStringInput
    aria-label={paramDef.label}
    value={(action.params[paramDef.name] as string) ?? ''}
    onChange={(val) => updateParam(index, paramDef.name, val)}
    placeholder={paramDef.hint ?? ''}
    eventFields={eventFields}
    objectKey={objectKey}
  />
) : (
  <input
    aria-label={paramDef.label}
    type="text"
    value={(action.params[paramDef.name] as string) ?? ''}
    onChange={(e) => updateParam(index, paramDef.name, e.target.value)}
    placeholder={paramDef.hint ?? ''}
    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
  />
```

- [ ] **Step 4: Run tests — confirm all 4 pass**

```bash
npx vitest run src/components/automation/__tests__/actions-step.test.tsx
```

Expected: `Tests  4 passed (4)`.

- [ ] **Step 5: Commit**

```bash
git add src/components/automation/actions-step.tsx \
        src/components/automation/__tests__/actions-step.test.tsx
git commit -m "feat(automation): wire TemplateStringInput into ActionsStep"
```

---

### Task 4: Update CreateTriggerModal

**Files:**
- Modify: `src/components/create-trigger-modal.tsx`
- Modify: `src/components/__tests__/create-trigger-modal.test.tsx`

- [ ] **Step 1: Update the test mock to include `useQuery`**

Open `src/components/__tests__/create-trigger-modal.test.tsx`.

**a) Add `mockUseQuery` hoisted var** — add after the existing `mockMutateAsync` hoisted var (after line 5):
```ts
const mockUseQuery = vi.hoisted(() => vi.fn());
```

**b) Replace the `@tanstack/react-query` mock** (lines 7–9). Current:
```ts
vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(() => ({ mutateAsync: mockMutateAsync, isPending: false, reset: vi.fn() })),
}));
```

Replace with:
```ts
vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(() => ({ mutateAsync: mockMutateAsync, isPending: false, reset: vi.fn() })),
  useQuery:    mockUseQuery,
}));
```

**c) Add `mockUseQuery` default return in `beforeEach`** (after `vi.clearAllMocks()` on line 28):
```ts
// Return empty events by default — tests that need events can override
mockUseQuery.mockReturnValue({
  data:      { data: [{ name: 'customer.create', plugin: 'customer-data', description: 'Customer created', fields: [{ name: 'name', type: 'string' }] }] },
  isLoading: false,
  isError:   false,
});
```

**d) Also add `getAvailableEvents` and `getAvailableActions` to the `api-client` mock** (line 16–17). Current:
```ts
vi.mock('@/lib/api-client', () => ({
  crmApi: { createTrigger: vi.fn() },
}));
```

Replace with:
```ts
vi.mock('@/lib/api-client', () => ({
  crmApi: {
    createTrigger:      vi.fn(),
    getAvailableEvents: vi.fn(),
    getAvailableActions: vi.fn(),
  },
}));
```

- [ ] **Step 1e: Fix pre-existing broken assertions in `create-trigger-modal.test.tsx`**

The existing test file was written for an older 2-step version of the modal and has four categories of breakage that must all be fixed now since we are touching the file. Apply each fix below:

**a) Active toggle aria-label mismatch** — component uses `aria-label="Active"`, not `"Active when created"`. Find these two tests (lines 60–69) and update the `getByRole` query:

Find (appears twice):
```ts
screen.getByRole('switch', { name: /active when created/i })
```
Replace both with:
```ts
screen.getByRole('switch', { name: /^active$/i })
```

**b) Event type option text** — the option renders as `"{ev.name} — {ev.description}"` (e.g. `"customer.create — Customer created"`). The existing test queries for exact name `'customer.create'` which no longer matches.

Find:
```ts
expect(screen.getByRole('option', { name: 'customer.create' })).toBeInTheDocument();
```
Replace with:
```ts
expect(screen.getByRole('option', { name: /customer\.create/i })).toBeInTheDocument();
```

**c) Step navigation assertion** — `'advances to step 2 when Next is clicked with a name'` asserts "Create Trigger" is visible after one Next click, but step 2 shows "Next →" not "Create Trigger" in a 3-step modal.

Find (around line 81):
```ts
expect(screen.getByRole('button', { name: /create trigger/i })).toBeInTheDocument();
expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument();
```
Replace with:
```ts
// At step 2 "Back" appears and "Conditions" heading is visible
expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
expect(screen.getByText(/conditions/i)).toBeInTheDocument();
```

**d) Submission tests only navigate one step** — all tests that submit the form do `Next` once (step 1→2) then immediately click "Create Trigger". In the 3-step modal, "Create Trigger" only appears at step 3. A second `Next` click is needed after step 2 to reach step 3. Fix every submission test (5 tests, lines ~137–210) by adding a second `fireEvent.click(screen.getByRole('button', { name: /next/i }))` between the first Next click and the "Create Trigger" click.

For every test that has this pattern:
```ts
fireEvent.click(screen.getByRole('button', { name: /next/i }));
// (possibly other steps like adding conditions)
fireEvent.click(screen.getByRole('button', { name: /create trigger/i }));
```

Add a second Next click (to navigate step 2 → step 3) immediately before the "Create Trigger" click:
```ts
fireEvent.click(screen.getByRole('button', { name: /next/i })); // step 1 → 2
// (possibly other steps like adding conditions)
fireEvent.click(screen.getByRole('button', { name: /next/i })); // step 2 → 3
fireEvent.click(screen.getByRole('button', { name: /create trigger/i }));
```

The **four** submission tests that actually submit the form — add a second Next click before the "Create Trigger" click:
- `'submits with empty conditions as {}'`
- `'submits with AND conditions when rows are filled'`
- `'calls onSuccess and onClose after successful submit'`
- `'shows API error when mutateAsync throws'`

The **validation test** (`'does not submit if a condition row is missing a value'`) is different — it intentionally stays on step 2 because invalid conditions block navigation to step 3. Fix it by replacing the "Create Trigger" click with a "Next →" click (which triggers validation) and removing the "Create Trigger" assertion. The new version of this test:

```ts
it('does not submit if a condition row is missing a value', async () => {
  render(<CreateTriggerModal {...defaultProps} />);
  fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
  fireEvent.click(screen.getByRole('button', { name: /next/i }));   // step 1 → 2
  fireEvent.click(screen.getByRole('button', { name: /add condition/i }));
  // leave value empty — do NOT fill it
  fireEvent.click(screen.getByRole('button', { name: /next/i }));   // step 2 → stays at 2 (validation fails)
  expect(await screen.findByText(/value is required/i)).toBeInTheDocument();
  expect(mockMutateAsync).not.toHaveBeenCalled();
});
```

> **Note:** The `ActionsStep` rendered at step 3 also calls `useQuery` (for the actions catalog). Since `mockUseQuery` is set up with events data (not actions data), `ActionsStep` will render with a dummy catalog — this is harmless as the submission tests don't interact with action buttons.

- [ ] **Step 2: Run existing tests — confirm they pass after mock + assertion fixes**

```bash
npx vitest run src/components/__tests__/create-trigger-modal.test.tsx
```

Expected: all tests pass (including the two previously broken ones that were just fixed).

- [ ] **Step 3: Update `CreateTriggerModal` to pass new props to `ActionsStep`**

Open `src/components/create-trigger-modal.tsx`.

Find the `<ActionsStep …>` JSX (around line 413–416):
```tsx
<ActionsStep
  actions={form.actions}
  onChange={(actions) => setForm((prev) => ({ ...prev, actions }))}
/>
```

Replace with:
```tsx
<ActionsStep
  actions={form.actions}
  onChange={(actions) => setForm((prev) => ({ ...prev, actions }))}
  eventType={form.eventType}
  eventFields={selectedEventFields}
/>
```

- [ ] **Step 4: Run all frontend tests — confirm no regressions**

```bash
npm test
```

Expected: all tests pass (or same pre-existing failures as before, if any).

- [ ] **Step 5: Commit**

```bash
git add src/components/create-trigger-modal.tsx \
        src/components/__tests__/create-trigger-modal.test.tsx
git commit -m "feat(automation): pass eventType and eventFields to ActionsStep"
```

---

## Final Check

- [ ] **Run full test suite one more time**

```bash
npm test
```

Expected: all new tests pass with no regressions.

- [ ] **Manual smoke test** (optional but recommended)
  1. Start the frontend dev server: `npm run dev` (from `frontend/web/`)
  2. Log in as `admin@acme.example.com` / `password123` at `http://localhost:3002`
  3. Navigate to Automation → New Trigger
  4. Step 1: name = "Test", event = `customer.create` → Next
  5. Step 2: skip → Next
  6. Step 3: add "Create Support Case" action
  7. Click `{}` next to the **Title** field — popover should appear showing "name", "email" fields under "CUSTOMER" header
  8. Click "name" — `{{customer.name}}` should be inserted into the Title field
  9. Verify `{}` button is absent if you go back to step 1 and clear the event selection
