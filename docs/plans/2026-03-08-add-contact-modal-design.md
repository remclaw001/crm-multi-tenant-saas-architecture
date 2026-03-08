# Add Contact Modal — Design Doc

**Goal:** Add a modal dialog to the Contacts page so users can create a new contact without leaving the page.

**Approved:** 2026-03-08

---

## Architecture

Two files changed:

1. **`frontend/web/src/components/add-contact-modal.tsx`** — new self-contained modal component
2. **`frontend/web/src/app/(crm)/contacts/page.tsx`** — add button + wire up modal

## Component Design

### `AddContactModal`

```
Props: { open: boolean; onClose: () => void; onSuccess: () => void }
```

- Manages its own form state: `name`, `email`, `phone`, `company`
- Manages its own error state: `Record<field, string>` + `apiError: string`
- Uses `useMutation` from TanStack Query to call `crmApi.createCustomer()`
- On success: calls `onSuccess()` then `onClose()`
- On unmount / close: resets all form state

**UI structure:**
- Fixed overlay backdrop (`position: fixed, inset-0, bg-black/50`)
- Centered dialog card (`max-w-md, rounded-lg, bg-card, shadow-xl`)
- Header: "Add Contact" title + X close button
- Form body: 4 fields (name, email, phone, company)
- Footer: Cancel button + Save button (disabled while submitting)

### `contacts/page.tsx` changes

- Add `const [modalOpen, setModalOpen] = useState(false)`
- Add "Add Contact" button in the page header (top-right, next to count text)
- Render `<AddContactModal>` with `onSuccess={() => queryClient.invalidateQueries({ queryKey: ['customers', tenantId] })}`

## Validation (client-side, fires on submit)

| Field | Rule |
|---|---|
| `name` | Required — trim, must not be empty |
| `email` | Optional — if provided, must match basic email regex |
| `phone` | Optional — no validation |
| `company` | Optional — no validation |

Inline error message appears below each field. Submit button stays enabled until submission starts.

## Error Handling

- Validation errors → shown inline per field, submission blocked
- API error → generic message shown at bottom of form: `"Failed to save. Please try again."`
- Network error → same generic message

## Tech Stack

- React `useState` for form + error state
- TanStack Query `useMutation` + `useQueryClient` for API call + cache invalidation
- Tailwind CSS for styling (no external component library)
- Lucide `X` icon for close button
- Auth context via `useAuthStore` (token + tenantId)
