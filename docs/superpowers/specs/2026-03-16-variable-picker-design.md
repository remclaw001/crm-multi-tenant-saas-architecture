# Variable Picker for Template String Inputs

**Date:** 2026-03-16
**Status:** Approved

## Problem

Action params of type `template-string` (e.g. webhook body, case title, update-field value) currently render as a plain text input. Users must type `{{customer.name}}` by hand, relying on hint placeholders to discover valid variables. This is error-prone and not discoverable.

## Solution

Replace the plain `<input>` for `template-string` params with a `TemplateStringInput` component that includes an inline `{}` button. Clicking the button opens a 2-level popover: first pick an object (e.g. *Customer*), then pick a field (e.g. *name*). Clicking a field inserts `{{customer.name}}` at the cursor position in the input.

## Scope

- **Frontend only** — no backend changes required.
- **Affected files:** `ActionsStep`, new `TemplateStringInput`, new `VariablePickerPopover`.
- **Affected params:** all `ActionParamSchema` entries with `type: 'template-string'` (currently: `webhook.call.body`, `customer.update_field.value`, `case.create.title`, `case.create.description`).

## Data Flow

`CreateTriggerModal` already fetches `availableEvents` and derives `selectedEventFields: EventField[]` and `form.eventType: string`. These are passed down to `ActionsStep` as new props, which passes them to `TemplateStringInput` for each `template-string` param.

The **object key** (e.g. `customer`) is derived on the frontend from `eventType.split('.')[0]`. The inserted variable is `{{<objectKey>.<fieldName>}}`.

## Components

### `TemplateStringInput` (`components/automation/template-string-input.tsx`)

A self-contained component that wraps an `<input>` with the `{}` picker button.

**Props:**
```ts
interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  eventFields: EventField[];   // fields for the selected event
  objectKey: string;           // e.g. "customer" — prefix for inserted variables
}
```

**Behaviour:**
- Renders a `<div>` with `position: relative`, an `<input>` with `padding-right` to accommodate the button, and the `{}` button absolutely positioned inside on the right.
- Maintains a `ref` on the input to read `selectionStart`/`selectionEnd` when inserting.
- Manages `pickerOpen: boolean` state.
- When `eventFields` is empty, hides the `{}` button (nothing to pick).
- On insert: splices the variable string into the current value at `selectionStart` (fallback: append to end). After insert, closes the popover and restores focus + cursor position to after the inserted token.
- Closes popover on Escape or click-outside (via `useEffect` + `mousedown` listener on `document`).

### `VariablePickerPopover` (`components/automation/variable-picker-popover.tsx`)

A presentational popover with 2-level navigation.

**Props:**
```ts
interface Props {
  fields: EventField[];
  objectKey: string;
  onInsert: (variable: string) => void;
  onClose: () => void;
}
```

**States:**
- `level: 'objects' | 'fields'` — starts at `'objects'` unless there is only 1 object group (see optimisation below).

**Level 1 — Object list:**
- Header: "INSERT VARIABLE"
- Lists object groups. Currently only one group (derived from `objectKey`), displayed as e.g. "Customer".
- Click a group → transition to level 2.
- **Optimisation:** if `objectKey` represents only one group (always true for now), skip level 1 and open directly at level 2.

**Level 2 — Field list:**
- Header shows breadcrumb: back arrow `‹` + object name in caps.
- Click `‹` → return to level 1.
- Fields displayed in a 2-column grid, each cell shows field `name` (bold) and `type` (small, muted).
- Click a field → calls `onInsert('{{customer.name}}')` and `onClose()`.

**Positioning:** rendered below the `{}` button using `position: absolute; top: 100%; right: 0`. A `z-index` of 50 keeps it above other form content. Clipping handled by `overflow: visible` on the parent container.

## Modified: `ActionsStep` (`components/automation/actions-step.tsx`)

**New props:**
```ts
interface Props {
  actions: StoredAction[];
  onChange: (actions: StoredAction[]) => void;
  eventType: string;        // e.g. "customer.create"
  eventFields: EventField[]; // fields for the selected event
}
```

`objectKey` is derived inside `ActionsStep` as `eventType.split('.')[0]`.

For each param, the render branch changes:
- `type === 'enum'` → `<select>` (unchanged)
- `type === 'template-string'` → `<TemplateStringInput>` with `eventFields` and `objectKey`
- all other types (`string`, `url`) → plain `<input>` (unchanged)

## Modified: `CreateTriggerModal` (`components/create-trigger-modal.tsx`)

Pass two new props to `<ActionsStep>`:
```tsx
<ActionsStep
  actions={form.actions}
  onChange={(actions) => setForm((prev) => ({ ...prev, actions }))}
  eventType={form.eventType}
  eventFields={selectedEventFields}
/>
```

`selectedEventFields` is already computed in the modal:
```ts
const selectedEventFields: EventField[] = availableEvents
  .find((ev) => ev.name === form.eventType)
  ?.fields ?? [];
```

## Edge Cases

| Scenario | Behaviour |
|---|---|
| No event selected (step 1 not filled) | `eventFields = []` → `{}` button hidden |
| Event has no fields | `eventFields = []` → `{}` button hidden |
| Input value is empty, no cursor | Insert at position 0 (beginning) — the `selectionStart` of an unfocused input is `0` |
| User selects text before clicking `{}` | Variable replaces the selected range (`selectionStart` to `selectionEnd`) |
| Escape key while popover open | Closes popover, returns focus to input |
| Click outside popover | Closes popover |

## Testing

- **`TemplateStringInput` unit tests:** renders `{}` button when fields provided; hides `{}` when fields empty; calls `onChange` with correct inserted value at correct position; closes on Escape.
- **`VariablePickerPopover` unit tests:** renders field grid; calls `onInsert` with correct `{{key.field}}` string; back button returns to level 1; skips level 1 when single object.
- **`ActionsStep` unit tests:** passes `eventFields` and `objectKey` to `TemplateStringInput`; renders plain input for non-template params.
- No new integration tests required.

## Files Changed

| File | Change |
|---|---|
| `frontend/web/src/components/automation/template-string-input.tsx` | **New** |
| `frontend/web/src/components/automation/variable-picker-popover.tsx` | **New** |
| `frontend/web/src/components/automation/actions-step.tsx` | Add `eventType` + `eventFields` props; swap `<input>` for `<TemplateStringInput>` |
| `frontend/web/src/components/create-trigger-modal.tsx` | Pass `eventType` + `eventFields` to `<ActionsStep>` |
