# Add Campaign Modal — Design Spec

**Date:** 2026-03-17
**Plugin:** marketing
**Scope:** Frontend only — backend `POST /api/v1/plugins/marketing/campaigns` already exists.

---

## Goal

Add a "Add Campaign" button and modal to the Marketing page so users can create campaigns from the UI. Currently the page only lists campaigns with no way to create one.

---

## Context

**Backend (already implemented):**
- `POST /api/v1/plugins/marketing/campaigns` — accepts `{ name, campaign_type?, scheduled_at? }`
- `CreateCampaignInput`: `name: string`, `campaign_type?: 'email' | 'sms'`, `scheduled_at?: string`
- Default `campaign_type`: `'email'`

**Frontend (already implemented):**
- `crmApi.createCampaign(input, ctx)` in `src/lib/api-client.ts`
- `CampaignsList` component renders campaigns (read-only)
- `marketing/page.tsx` lists campaigns with a status filter dropdown

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

const EMPTY_FORM: FormState = { name: '', campaign_type: 'email', scheduled_at: '' };
```

**Validation:** `name.trim()` must be non-empty — show inline error `'Name is required'` below the input.

**Submission:**
- Call `crmApi.createCampaign({ name: form.name.trim(), campaign_type: form.campaign_type, scheduled_at: form.scheduled_at || undefined }, ctx)`
- On success: reset form, call `onSuccess()`, call `onClose()`
- On `ApiError`: display `err.body.detail ?? err.body.title ?? 'Server error (N)'` in a red box above the footer
- On unknown error: display `'Failed to save. Please try again.'`

**Reset:** `useEffect` watching `open` — when `open` becomes `false`, reset form, errors, and apiError.

**Structure** (follows `add-contact-modal.tsx` exactly):
- Backdrop: `fixed inset-0 z-50 flex items-center justify-center bg-black/50`, click outside closes
- Dialog: `role="dialog" aria-modal="true" aria-label="Add Campaign"`, `w-full max-w-md`
- Header: title + X close button
- Body: form fields with labels, `htmlFor`/`id` pairs on all inputs
- Footer: Cancel + Create Campaign (disabled + "Saving…" while pending)

---

## `marketing/page.tsx` Changes

1. Add `useState(false)` for `modalOpen`
2. Add `useQueryClient()` for cache invalidation
3. Add "Add Campaign" button in the header row (right side, same style as "Add Contact" button in contacts page)
4. Add `handleSuccess`: `queryClient.invalidateQueries({ queryKey: ['campaigns', tenantId] })`
5. Mount `<AddCampaignModal open={modalOpen} onClose={() => setModalOpen(false)} onSuccess={handleSuccess} />`

---

## Testing

New test file: `src/components/__tests__/add-campaign-modal.test.tsx`

Tests to cover:
1. Does not render when `open=false`
2. Renders form fields (name input, type select, schedule input) when `open=true`
3. Shows validation error when submitting with empty name
4. Calls `createCampaign` with correct payload on valid submit
5. Calls `onSuccess` and `onClose` after successful mutation
6. Shows API error message when `mutateAsync` rejects with `ApiError`
7. Resets form when modal closes (open → false)

**Mocking:** Use `vi.hoisted()` for `mockMutateAsync` and `mockUseQuery`/`mockUseMutation` per CLAUDE.md Vitest gotcha.
