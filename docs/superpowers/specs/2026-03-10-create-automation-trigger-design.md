# Create Automation Trigger — Design Spec

**Date:** 2026-03-10
**Feature:** Add "Create Trigger" functionality to the Automation plugin
**Scope:** Frontend only — backend API already supports `POST /api/v1/plugins/automation/triggers`

---

## Overview

Add a 2-step wizard modal to the automation page that lets users create automation triggers with name, event type, active state, and optional AND-logic conditions.

---

## UI Flow

### Entry Point
- Button "**+ Add Trigger**" on the automation page (`/automation`), top-right of the trigger list header.

### Step 1 — Basic Info
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Trigger Name | text input | Yes | Max 100 chars |
| Event Type | dropdown | Yes | Fixed list: `customer.create` |
| Active when created | toggle | No | Defaults to ON |

Step indicator: `① ——— ②` (step 1 highlighted blue).
Footer: `[Next →]` button — disabled until Name is filled.

### Step 2 — Conditions
Optional. If left empty, trigger fires on every event.

**Condition rows (AND logic):**
Each row: `[Attribute ▾]` `[Operator ▾]` `[Value input]` `[× remove]`

Between rows: AND badge.
Footer: `[← Back]` `[Create Trigger]`
"**+ Add condition**" link adds a new row.

**Attributes** (for `customer.create`):
- `name`, `email`, `phone`, `company`

**Operators:**
- `equals`, `not_equals`, `contains`, `starts_with`, `is_empty`, `is_not_empty`
- For `is_empty` / `is_not_empty`: value input is hidden

---

## Data Model

Conditions stored in `automation_triggers.conditions` (JSONB):

```json
{
  "and": [
    { "field": "company", "op": "equals", "value": "Acme Corp" },
    { "field": "email",   "op": "contains", "value": "@gmail.com" }
  ]
}
```

Empty conditions (no rows added): `{}` — backend treats as "always fire".

`actions` stored as `[]` (no actions UI in this iteration).

---

## Components

### New: `create-trigger-modal.tsx`
Location: `frontend/web/src/components/create-trigger-modal.tsx`

Props:
```typescript
interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void; // triggers list refetch
}
```

Internal state:
```typescript
type Step = 1 | 2;
interface FormState {
  name: string;
  eventType: string;
  isActive: boolean;
  conditions: ConditionRow[];
}
interface ConditionRow {
  id: string;      // nanoid for React key
  field: string;
  op: string;
  value: string;
}
```

### Modified: `automation/page.tsx`
- Add `useState` for modal open/close
- Add `+ Add Trigger` button
- Render `<CreateTriggerModal>` with `onSuccess={() => refetch()}`

---

## API Call

```typescript
crmApi.createTrigger({
  name: form.name,
  event_type: form.eventType,
  is_active: form.isActive,
  conditions: form.conditions.length > 0
    ? { and: form.conditions.map(r => ({ field: r.field, op: r.op, value: r.value })) }
    : {},
  actions: [],
}, ctx)
```

---

## Validation

**Step 1 (client-side):**
- Name: required, non-empty after trim

**Step 2 (client-side):**
- Each condition row: field + op required; value required unless op is `is_empty` / `is_not_empty`

**API errors:** displayed inline above the Create button.

---

## Constants (defined in component)

```typescript
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
```

---

## Out of Scope

- Edit trigger (separate feature)
- Delete trigger (separate feature)
- Actions UI
- OR logic in conditions
- Custom event types (free-text)
