# Edit Case Modal — Design Spec

**Date:** 2026-03-10

## Overview

Add the ability to edit an existing support case. Clicking anywhere on a case card opens an edit modal pre-filled with the case's current values.

## Scope

Five deliverables:
1. Backend: `GET /api/v1/users` endpoint
2. Frontend type + API client method
3. `EditCaseModal` component + tests
4. `CasesList` updated to support click-to-edit
5. `cases/page.tsx` wired up

---

## 1. Backend — `GET /api/v1/users`

**Route:** `GET /api/v1/users`
**Auth:** `JwtAuthGuard` (standard JWT, no extra guard)
**Tenant scoping:** Automatic via `TenantContext` + `QueryInterceptor` — `WHERE tenant_id` is added by the interceptor, never manually.

**Response:**
```json
[{ "id": "uuid", "name": "Alice", "email": "alice@acme.com" }]
```

**Implementation:**
- New `UsersController` + `UsersService` under `backend/src/api/v1/users/`
- `UsersService.list()` queries `users` table via `KNEX_INSTANCE`; returns `id`, `name`, `email` only (no password hash)
- Register controller in a new `UsersModule`, import into `ApiV1Module`
- Unit test: mock Knex, assert correct columns returned

---

## 2. Frontend — Type + API Client

**New type** in `src/types/api.types.ts`:
```typescript
export interface TenantUser {
  id: string;
  name: string;
  email: string;
}
```

**New method** in `src/lib/api-client.ts`:
```typescript
getUsers(ctx: AuthCtx): Promise<TenantUser[]> {
  return request('/api/v1/users', ctx);
}
```

---

## 3. `EditCaseModal` Component

**File:** `frontend/web/src/components/edit-case-modal.tsx`

### Props
```typescript
interface Props {
  supportCase: SupportCase;
  onClose: () => void;
  onSuccess: () => void;
}
```
No `open` prop — parent controls mount/unmount via `{editingCase && <EditCaseModal ... />}` (same pattern as `EditContactModal`).

### Fields
| Field | Type | Validation |
|---|---|---|
| Title | text input, `required` | Required (non-empty after trim) |
| Description | textarea | Optional |
| Status | `<select>` | Options: open, in_progress, resolved, closed |
| Priority | 3-button toggle | Low / Medium / High; `aria-pressed` |
| Assigned To | `<select>` | Options: "Unassigned" + users from `getUsers`; stores user UUID or `null` |

### Behavior
- `useEffect` resets form when `supportCase.id` changes (user opens different case)
- `useQuery` fetches users (always enabled — modal is only mounted when open)
- `useMutation` calls `crmApi.updateCase(supportCase.id, input, ctx)`
- On success: `onSuccess()` then `onClose()` — caller owns cache invalidation
- On API error: inline error message above footer buttons
- Buttons disabled while `mutation.isPending`
- Submit button label: `isPending ? 'Saving…' : 'Save'`

### Users loading states
- While loading: Assigned To select shows "Loading users…" and is disabled
- On error: select shows "Failed to load users" and is disabled

---

## 4. `CasesList` Component

**File:** `frontend/web/src/components/cases-list.tsx`

Add prop `onEdit: (c: SupportCase) => void`.

Each card:
- `cursor-pointer` class
- `onClick={() => onEdit(c)}`
- Hover style: `hover:bg-muted/50` (matches ContactsList row hover)

---

## 5. `cases/page.tsx`

Add state:
```typescript
const [editingCase, setEditingCase] = useState<SupportCase | null>(null);
```

`handleSuccess` already invalidates `['cases', tenantId]` — reuse it for edit.

Pass `onEdit` to `CasesList`:
```tsx
<CasesList cases={filtered} onEdit={setEditingCase} />
```

Mount modal conditionally:
```tsx
{editingCase && (
  <EditCaseModal
    supportCase={editingCase}
    onClose={() => setEditingCase(null)}
    onSuccess={handleSuccess}
  />
)}
```

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Title empty | Inline field error: "Title is required" |
| API update fails | Inline error above footer: "Failed to save. Please try again." |
| Users load fails | Assigned To select disabled with "Failed to load users" |

---

## Testing

- `EditCaseModal`: unit tests with Vitest + Testing Library
  - Renders all 5 fields pre-filled from `supportCase`
  - Validation: title required
  - Correct payload sent to `mutateAsync`
  - `onSuccess` + `onClose` called after success
  - API error displayed
  - Users loaded into Assigned To dropdown
  - Users loading/error states
  - `vi.hoisted()` for all mock variables referenced in `vi.mock()` factories
- `CasesList`: test that `onEdit` is called with correct case on card click
- Backend `UsersService`: unit test with mocked Knex

---

## Out of Scope

- Delete case (separate feature)
- Inline editing without modal
- Assigned To using free-text input
