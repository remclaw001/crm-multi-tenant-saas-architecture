# Variable Picker for Template String Inputs

**Date:** 2026-03-16
**Status:** Approved

## Problem

Action params of type `template-string` (e.g. webhook body, case title, update-field value) currently render as a plain text input. Users must type `{{customer.name}}` by hand, relying on hint placeholders to discover valid variables. This is error-prone and not discoverable.

## Solution

Replace the plain `<input>` for `template-string` params with a `TemplateStringInput` component that includes an inline `{}` button. Clicking the button opens a 2-level popover: first pick an object (e.g. *Customer*), then pick a field (e.g. *name*). Clicking a field inserts `{{<objectKey>.<fieldName>}}` at the cursor position in the input.

## Scope

- **Frontend only** — no backend changes required.
- **Affected files:** `ActionsStep`, new `TemplateStringInput`, new `VariablePickerPopover`.
- **Affected params:** all `ActionParamSchema` entries with `type: 'template-string'` (currently: `webhook.call.body`, `customer.update_field.value`, `case.create.title`, `case.create.description`).

## Data Flow

`CreateTriggerModal` already fetches `availableEvents` and derives `selectedEventFields: EventField[]` (lines 118–120 of `create-trigger-modal.tsx` — **this code already exists, no changes needed there**). These are passed down to `ActionsStep` as new props, which passes them to `TemplateStringInput` for each `template-string` param.

The **object key** (e.g. `customer`) is derived on the frontend from `eventType.split('.')[0]`. The inserted variable is `{{<objectKey>.<fieldName>}}`. This convention works because all current events are named `<entity>.<verb>` where the first segment is the variable namespace the backend template engine expects (e.g. `customer.create` → variables are `{{customer.*}}`). Future events **must** follow this same naming convention for the picker to produce correct tokens.

**Stale variables:** if the user returns to step 1 and changes the event type, any `{{customer.name}}` tokens already typed into action params are not cleaned up. This is acceptable — the backend validates templates at execution time, not at save time.

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
  'aria-label'?: string;       // forwarded to the inner <input> for accessibility
  className?: string;          // applied to the outer wrapper <div>
  eventFields: EventField[];   // fields for the selected event
  objectKey: string;           // e.g. "customer" — prefix for inserted variables
}
```

**Behaviour:**
- Renders a `<div className={className}>` with `position: relative`, an `<input>` (with `aria-label` forwarded and `padding-right` to accommodate the button), and the `{}` button absolutely positioned inside the right edge.
- Maintains a `ref` on the `<input>` to capture `selectionStart`/`selectionEnd` at the moment `{}` is clicked (before focus shifts to the button).
- Manages `pickerOpen: boolean` state.
- When `eventFields` is empty, hides the `{}` button entirely.
- **On insert:** replaces the range `[selectionStart, selectionEnd]` in the current value with the variable string (when `selectionStart === selectionEnd` this is a pure insert with no deletion). If `selectionStart` is `null` (browser returned null for unfocused input) → append to end. After insert, closes the popover and restores focus + places cursor immediately after the inserted token.
- **Close triggers:** Escape key on the input or button; `mousedown` on `document` outside the component (via `useEffect`).

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

**Current implementation — single-level (level 1 skipped):**

The component always opens directly at the field list. Level 1 (object selection) is not rendered in the current implementation because there is always exactly one object group. The `level` state and level-1 scaffolding are intentionally omitted from the current implementation to keep it simple. When a future event introduces a second object group, the level-1 layer should be added at that point alongside a prop change to carry the full groups structure.

**Field list (the only rendered level):**
- Header: object name in caps (e.g. `CUSTOMER`). No back arrow is rendered.
- Fields displayed in a 2-column grid; each cell shows `field.name` (bold) and `field.type` (small, muted).
- Click a field → calls `onInsert(`\`{{${objectKey}.${field.name}}}\``)` then `onClose()`.

**Positioning:** `position: absolute; top: 100%; right: 0; z-index: 50` — rendered below the `{}` button. The parent wrapper has `overflow: visible` to avoid clipping.

## Modified: `ActionsStep` (`components/automation/actions-step.tsx`)

**Updated props interface:**
```ts
interface Props {
  actions: StoredAction[];
  onChange: (actions: StoredAction[]) => void;
  eventType: string;         // e.g. "customer.create"
  eventFields: EventField[]; // fields for the selected event
}
```

`objectKey` is derived inside the component as `eventType.split('.')[0]`.

Render branch for each param:
- `type === 'enum'` → `<select>` (unchanged)
- `type === 'template-string'` → `<TemplateStringInput aria-label={paramDef.label} eventFields={eventFields} objectKey={objectKey} … />`
- all other types (`string`, `url`) → plain `<input aria-label={paramDef.label} …>` (unchanged)

## Modified: `CreateTriggerModal` (`components/create-trigger-modal.tsx`)

The `selectedEventFields` derivation already exists (lines 118–120). Only change: add the two new props to the `<ActionsStep>` JSX:

```tsx
<ActionsStep
  actions={form.actions}
  onChange={(actions) => setForm((prev) => ({ ...prev, actions }))}
  eventType={form.eventType}
  eventFields={selectedEventFields}
/>
```

## Edge Cases

| Scenario | Behaviour |
|---|---|
| No event selected (step 1 not filled) | `eventFields = []` → `{}` button hidden |
| Event has no fields | `eventFields = []` → `{}` button hidden |
| Input not focused when `{}` clicked | `selectionStart` may be `null` → append variable to end of current value |
| User selects text before clicking `{}` | Variable replaces selected range (`selectionStart` to `selectionEnd`); no text selected = pure insert |
| Escape key while popover open | Closes popover, returns focus to input |
| Click outside popover | Closes popover (`mousedown` on document) |
| Event type changed after variables inserted | Stale `{{old.var}}` tokens left as-is; backend validates at runtime |

## Testing

- **`TemplateStringInput` unit tests:** renders `{}` button when fields provided; hides `{}` when fields empty; calls `onChange` with variable inserted at correct position; replaces selected range; appends when `selectionStart` is null; closes on Escape.
- **`VariablePickerPopover` unit tests:** renders field grid; calls `onInsert` with correct `` `{{${objectKey}.${field.name}}}` `` string; no back arrow rendered (level-1 not implemented in current scope).
- **`ActionsStep` unit tests:** passes `eventFields` and `objectKey` to `TemplateStringInput`; renders plain `<input>` for `string`/`url` params; renders `<select>` for `enum` params.
- No new integration tests required.

## Files Changed

| File | Change |
|---|---|
| `frontend/web/src/components/automation/template-string-input.tsx` | **New** |
| `frontend/web/src/components/automation/variable-picker-popover.tsx` | **New** |
| `frontend/web/src/components/automation/actions-step.tsx` | Add `eventType` + `eventFields` props; swap `<input>` for `<TemplateStringInput>` on `template-string` params |
| `frontend/web/src/components/create-trigger-modal.tsx` | Pass `eventType` + `eventFields` to `<ActionsStep>` |
