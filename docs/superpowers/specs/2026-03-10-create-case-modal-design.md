# Design: Create Case Modal

**Date:** 2026-03-10
**Scope:** Frontend only — backend `POST /api/v1/plugins/customer-care/cases` already implemented.

## Summary

Add a "New Case" button to the Cases page that opens a modal dialog for creating a support case.

## UI

- **Trigger:** "+ New Case" button in the Cases page header (top-right, next to the status filter).
- **Layout:** Modal dialog with backdrop overlay. Pressing Cancel or clicking outside closes it.
- **Fields:**
  | Field | Type | Required | Default |
  |---|---|---|---|
  | Customer | `<select>` populated from `getCustomers()` | Yes | — |
  | Title | `<input type="text">` | Yes | — |
  | Description | `<textarea>` | No | — |
  | Priority | 3-button toggle (Low / Medium / High) | No | Medium |

## Components

### `components/create-case-modal.tsx` (new)

- Props: `open: boolean`, `onClose: () => void`
- Fetches customers via `useQuery(['customers', tenantId], () => crmApi.getCustomers(ctx))` — only when `open === true` (`enabled: open`).
- Submits via `useMutation` calling `crmApi.createCase(input, ctx)`.
- On success: call `qc.invalidateQueries(['cases', tenantId])` then `onClose()`.
- On error: display inline error message inside the modal (below the form, above the footer buttons).
- Resets form state when closed.

### `app/(crm)/cases/page.tsx` (update)

- Add `useState<boolean>` for modal open state.
- Render `<CreateCaseModal open={modalOpen} onClose={() => setModalOpen(false)} />`.
- Add "+ New Case" button in the existing header `flex` row that sets `modalOpen(true)`.

## Data flow

```
User clicks "+ New Case"
  → setModalOpen(true)
  → modal fetches customers (getCustomers)
  → user fills form → clicks "Create Case"
  → useMutation → POST /api/v1/plugins/customer-care/cases
  → success → invalidateQueries(['cases']) + onClose()
  → cases list auto-refetches and shows new case
```

## Error handling

- If `getCustomers` fails: show "Failed to load customers" inside the modal customer field.
- If `createCase` mutation fails: show the API error message inline in the modal.
- Title field: HTML5 `required` — browser prevents submit if empty.
