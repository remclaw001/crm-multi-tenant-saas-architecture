# Add Campaign Modal — Design Spec

**Date:** 2026-03-17
**Plugin:** marketing
**Scope:** Frontend only — backend `POST /api/v1/plugins/marketing/campaigns` already exists.

---

## Goal

Add an "Add Campaign" button and modal to the Marketing page so users can create campaigns from the UI. Currently the page only lists campaigns with no way to create one.

---

## Context

**Backend (already implemented):**
- `POST /api/v1/plugins/marketing/campaigns` — accepts `{ name, campaign_type?, scheduled_at? }`
- `CreateCampaignInput`: `name: string`, `campaign_type?: 'email' | 'sms'`, `scheduled_at?: string`
- Default `campaign_type`: `'email'`

**Frontend (already implemented):**
- `crmApi.createCampaign(input, ctx)` in `src/lib/api-client.ts`
- `CampaignsList` component renders campaigns (read-only)
- `marketing/page.tsx` lists campaigns with a status filter `<select>` dropdown on the right side of the header row

**Pattern to follow:** `src/components/add-contact-modal.tsx` — modal with `open/onClose/onSuccess` props, `useMutation`, form state, validation, reset on close.

---

## Files

| File | Status | Change |
|---|---|---|
| `src/components/add-campaign-modal.tsx` | **Create** | New modal component |
| `src/app/(plugins)/marketing/page.tsx` | **Modify** | Add button + modal |

---

## `AddCampaignModal` Component

**File:** `src/components/add-campaign-modal.tsx`

**Props:**
```ts
interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}
```

**Form fields:**

| Field | Type | Required | Default |
|---|---|---|---|
| `name` | text input | Yes | `''` |
| `campaign_type` | `<select>` (Email / SMS) | No | `'email'` |
| `scheduled_at` | `datetime-local` input | No | `''` |

**Form state:**
```ts
interface FormState {
  name: string;
  campaign_type: 'email' | 'sms';
  scheduled_at: string;
}

interface FormErrors {
  name?: string;
}

const EMPTY_FORM: FormState = { name: '', campaign_type: 'email', scheduled_at: '' };
```

**Auth context:** Read `token` and `tenantId` from `useAuthStore()`. Build ctx inline:
```ts
const { token, tenantId } = useAuthStore();
const ctx = { token: token ?? '', tenantId: tenantId ?? '' };
```

**Validation:** `name.trim()` must be non-empty — show inline error `'Name is required'` below the input.

**Submission:**
- Call `crmApi.createCampaign({ name: form.name.trim(), campaign_type: form.campaign_type, scheduled_at: form.scheduled_at || undefined }, ctx)`
- The payload always includes `campaign_type`. `scheduled_at` is `undefined` when the field is empty.
- On success: reset form, call `onSuccess()`, call `onClose()`
- On `ApiError`: display `` err.body.detail ?? err.body.title ?? `Server error (${err.status})` `` in a red box above the footer
- On unknown error: display `'Failed to save. Please try again.'`

**Change handlers:**
- Text inputs (`name`, `scheduled_at`): `(e: React.ChangeEvent<HTMLInputElement>) => setForm(prev => ({ ...prev, field: e.target.value }))`
- `campaign_type` select: `(e: React.ChangeEvent<HTMLSelectElement>) => setForm(prev => ({ ...prev, campaign_type: e.target.value as 'email' | 'sms' }))`

**Reset:** `useEffect` watching `open` — when `open` becomes `false`, reset form, errors, and apiError.

**Structure** (follows `add-contact-modal.tsx` exactly):
- `'use client'` directive at top
- Backdrop: `fixed inset-0 z-50 flex items-center justify-center bg-black/50`, click outside closes
- Dialog: `role="dialog" aria-modal="true" aria-label="Add Campaign"`, `w-full max-w-md`
- Header: title + X close button
- Body: form fields with labels, `htmlFor`/`id` pairs on all inputs and the select
- Footer: Cancel + submit button — label is `mutation.isPending ? 'Saving…' : 'Create Campaign'`, disabled while pending

---

## `marketing/page.tsx` Changes

1. Add `useState(false)` for `modalOpen`
2. Add `useQueryClient()` for cache invalidation
3. **Header layout:** The existing `<select>` status filter currently sits alone on the right side of the header row. Wrap it and the new "Add Campaign" button together in a `flex items-center gap-3` container:
   ```tsx
   <div className="flex items-center gap-3">
     <select ...>...</select>
     <button onClick={() => setModalOpen(true)} ...>
       <Plus className="h-4 w-4" /> Add Campaign
     </button>
   </div>
   ```
   Button style: same as "Add Contact" button in contacts page (`bg-primary text-primary-foreground`).
4. Add `handleSuccess`: `queryClient.invalidateQueries({ queryKey: ['campaigns', tenantId] })`
5. Mount `<AddCampaignModal open={modalOpen} onClose={() => setModalOpen(false)} onSuccess={handleSuccess} />`

---

## Testing

New test file: `src/components/__tests__/add-campaign-modal.test.tsx`

**Mocking:** Use `vi.hoisted()` for `mockMutateAsync` and `mockUseMutation` per CLAUDE.md Vitest gotcha. The modal uses no `useQuery` — do not mock it.

Tests to cover:

1. **Does not render when `open=false`** — `queryByRole('dialog')` returns null
2. **Renders form fields when `open=true`** — name input, type select (defaulting to `'email'`), schedule input
3. **Shows validation error on empty name submit** — inline error `'Name is required'` visible after submit with blank name
4. **Calls `createCampaign` with correct payload on valid submit** — assert `mockMutateAsync` called with `{ name: 'Test Campaign', campaign_type: 'email', scheduled_at: undefined }`
5. **Calls `onSuccess` and `onClose` after successful mutation** — both called once after `mutateAsync` resolves
6. **Shows API error message when `mutateAsync` rejects with `ApiError`** — error text visible in the DOM
7. **Resets form when modal closes (open → false)** — after re-rendering with `open=false` then `open=true`, name input is empty again
