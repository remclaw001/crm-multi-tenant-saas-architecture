# Delete Contact — Design Doc

**Goal:** Add a trash-icon delete button to each contact row. Clicking it opens a small confirmation modal. Confirming deletes the contact via `DELETE /api/v1/plugins/customer-data/customers/:id`.

**Approved:** 2026-03-08

---

## Architecture

Four files changed:

1. **`frontend/web/src/lib/api-client.ts`** — add `deleteCustomer(id, ctx)` → `DELETE .../customers/:id` (204 No Content)
2. **`frontend/web/src/components/delete-contact-modal.tsx`** — new confirmation modal, no form
3. **`frontend/web/src/components/contacts-list.tsx`** — add `onDelete` prop + Trash2 button in Actions column
4. **`frontend/web/src/app/(crm)/contacts/page.tsx`** — add `deletingContact` state + render `DeleteContactModal`

## Component Design

### `DeleteContactModal`

```
Props: { contact: Customer; onClose: () => void; onSuccess: () => void }
```

- No form, no validation — confirmation only
- Body: "Are you sure you want to delete **[contact.name]**? This action cannot be undone."
- Uses `useMutation` → `crmApi.deleteCustomer(contact.id, ctx)` (void return, 204)
- On success: `onSuccess()` then `onClose()`
- On API error: shows "Failed to delete. Please try again." at bottom of modal
- Footer: Cancel (ghost) + Delete button (`bg-destructive text-destructive-foreground`, red)
- Both buttons disabled while `mutation.isPending`
- `role="dialog"` + `aria-modal="true"` on the card div
- Backdrop click closes modal (only when not pending)

### `contacts-list.tsx` changes

- Add `onDelete: (contact: Customer) => void` as required prop
- Change `buildColumns(onEdit)` to `buildColumns(onEdit, onDelete)`
- Add `<Trash2>` icon button after the `<Pencil>` button in the actions column
- Trash button: `aria-label="Delete"`, calls `onDelete(row.original)`, styled with `hover:text-destructive`
- `useMemo` dep array: `[onEdit, onDelete]`

### `contacts/page.tsx` changes

- Add `const [deletingContact, setDeletingContact] = useState<Customer | null>(null)`
- Pass `onDelete={setDeletingContact}` to `<ContactsList>`
- Render after `<EditContactModal>` block:
  ```tsx
  {deletingContact && (
    <DeleteContactModal
      contact={deletingContact}
      onClose={() => setDeletingContact(null)}
      onSuccess={handleSuccess}
    />
  )}
  ```
- Reuses existing `handleSuccess` (invalidates `['customers', tenantId]` query)

## Error Handling

- API error → "Failed to delete. Please try again." shown in modal
- On success → modal closes, list auto-refreshes via cache invalidation
