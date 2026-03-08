# Edit Contact — Design Doc

**Goal:** Add an edit button (pencil icon) to each row in the Contacts table. Clicking it opens a pre-filled modal dialog to update the contact.

**Approved:** 2026-03-08

---

## Architecture

Four files changed:

1. **`frontend/web/src/lib/api-client.ts`** — add `updateCustomer(id, input, ctx)`
2. **`frontend/web/src/components/edit-contact-modal.tsx`** — new modal component, pre-filled from a `Customer` object
3. **`frontend/web/src/components/contacts-list.tsx`** — add Actions column with pencil button; accept `onEdit` callback
4. **`frontend/web/src/app/(crm)/contacts/page.tsx`** — manage `editingContact` state, wire `onEdit` + `EditContactModal`

## Component Design

### `EditContactModal`

```
Props: { contact: Customer; onClose: () => void; onSuccess: () => void }
```

- Pre-fills form fields (`name`, `email`, `phone`, `company`) from `contact` on open
- Resets form whenever `contact` changes (via `useEffect`)
- Uses `useMutation` → `crmApi.updateCustomer(contact.id, payload, ctx)`
- On success: calls `onSuccess()` then `onClose()`
- Same validation as `AddContactModal`: name required (trim), email format if provided

**UI structure:** identical to `AddContactModal` — fixed overlay, centered card, header with title + X, 4 fields, footer Cancel + Save.

### `contacts-list.tsx` changes

- Add prop `onEdit: (contact: Customer) => void`
- Add a final `Actions` column (no sort) with a `<Pencil>` icon button per row: `onClick={() => onEdit(row.original)`
- Button styled as a ghost icon button (no background, hover accent)

### `contacts/page.tsx` changes

- Add `const [editingContact, setEditingContact] = useState<Customer | null>(null)`
- Pass `onEdit={setEditingContact}` to `<ContactsList>`
- Render `{editingContact && <EditContactModal contact={editingContact} onClose={() => setEditingContact(null)} onSuccess={handleSuccess} />}` — reuses existing `handleSuccess` (invalidates query)

## Validation

Same rules as add:

| Field | Rule |
|---|---|
| `name` | Required — trim, must not be empty |
| `email` | Optional — if provided, must match basic email regex |
| `phone` | Optional — no validation |
| `company` | Optional — no validation |

## Error Handling

- Validation errors → shown inline per field, submission blocked
- API error → generic message at bottom of form: `"Failed to save. Please try again."`

## Tech Stack

- React `useState` + `useEffect` for form + reset state
- TanStack Query `useMutation` + `useQueryClient` for API call + cache invalidation
- Tailwind CSS (no external component library)
- Lucide `Pencil` + `X` icons
- Auth via `useAuthStore` (token + tenantId)
