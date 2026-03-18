# Edit Campaign — Design Spec

**Date:** 2026-03-18
**Plugin:** marketing
**Scope:** Frontend only — backend `PUT /api/v1/plugins/marketing/campaigns/:id` already exists.

---

## Goal

Allow users to edit existing campaigns by clicking a campaign card on the Marketing page. An edit modal opens pre-filled with the campaign's current values, lets the user change any editable field, and saves via the existing `PUT` endpoint.

---

## Context

**Backend (already implemented):**
- `PUT /api/v1/plugins/marketing/campaigns/:id` — accepts `UpdateCampaignInput`
- `UpdateCampaignInput`: `name?: string`, `status?: 'draft' | 'active' | 'paused' | 'completed'`, `target_count?: number`, `scheduled_at?: string | null`
- Note: `campaign_type` is not part of `UpdateCampaignInput` — it cannot be changed after creation

**Frontend (already implemented):**
- `crmApi.createCampaign` — create modal pattern to follow
- `CampaignsList` — renders campaign cards (read-only, no actions)
- `marketing/page.tsx` — lists campaigns with status filter and Add Campaign modal
- `add-campaign-modal.tsx` — established modal pattern (`open/onClose/onSuccess`, `useMutation`, `useEffect` reset, validation, `ApiError` handling)

**Pattern to follow:** `src/components/add-campaign-modal.tsx`

---

## Files

| File | Status | Change |
|---|---|---|
| `src/lib/api-client.ts` | **Modify** | Add `updateCampaign` method |
| `src/components/campaigns-list.tsx` | **Modify** | Add `onEdit` prop + click handler on cards |
| `src/components/edit-campaign-modal.tsx` | **Create** | New edit modal component |
| `src/app/(plugins)/marketing/page.tsx` | **Modify** | Add `editTarget` state; wire `CampaignsList` + modal |
| `src/components/__tests__/edit-campaign-modal.test.tsx` | **Create** | 7 tests |

---

## `api-client.ts` Change

Add `updateCampaign` after `createCampaign`:

```ts
updateCampaign(
  id: string,
  input: {
    name?: string;
    status?: 'draft' | 'active' | 'paused' | 'completed';
    target_count?: number;
    scheduled_at?: string | null;
  },
  ctx: AuthCtx,
): Promise<PluginItemResponse<Campaign>> {
  return request(`/api/v1/plugins/marketing/campaigns/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
    ...ctx,
  });
},
```

---

## `CampaignsList` Changes

Add `onEdit` prop:

```ts
export function CampaignsList({
  campaigns,
  onEdit,
}: {
  campaigns: Campaign[];
  onEdit: (campaign: Campaign) => void;
})
```

Each card `<div>` gets:
- `onClick={() => onEdit(c)}`
- `className` additions: `cursor-pointer hover:bg-accent/50`

---

## `EditCampaignModal` Component

**File:** `src/components/edit-campaign-modal.tsx`

**Props:**
```ts
interface Props {
  campaign: Campaign | null; // null = closed
  onClose: () => void;
  onSuccess: () => void;
}
```

Visibility is driven by `campaign !== null` — no separate `open` boolean. Return `null` immediately if `campaign` is null (after hooks).

**Form state:**
```ts
interface FormState {
  name: string;
  status: 'draft' | 'active' | 'paused' | 'completed';
  target_count: string;  // string for controlled input; converted to number on submit
  scheduled_at: string;  // datetime-local string
}

interface FormErrors {
  name?: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  status: 'draft',
  target_count: '',
  scheduled_at: '',
};
```

**Auth context:**
```ts
const { token, tenantId } = useAuthStore();
const ctx = { token: token ?? '', tenantId: tenantId ?? '' };
```

**Reset:** `useEffect` watching `campaign`:
- When `campaign` becomes non-null: set form to `{ name: campaign.name, status: campaign.status, target_count: campaign.target_count > 0 ? String(campaign.target_count) : '', scheduled_at: campaign.scheduled_at ? campaign.scheduled_at.slice(0, 16) : '' }`
- When `campaign` becomes null: reset form, errors, and apiError to empty/undefined

**Validation:** `name.trim()` must be non-empty — inline error `'Name is required'` below the input.

**Submission:**
```ts
crmApi.updateCampaign(
  campaign.id,
  {
    name: form.name.trim(),
    status: form.status,
    target_count: form.target_count ? Number(form.target_count) : undefined,
    scheduled_at: form.scheduled_at || null,
  },
  ctx,
)
```
- On success: call `onSuccess()`, call `onClose()`
- On `ApiError`: display `err.body.detail ?? err.body.title ?? \`Server error (${err.status})\`` in a red box above the footer
- On unknown error: display `'Failed to save. Please try again.'`

**Form fields:**

| Field | Type | Required | Initial value |
|---|---|---|---|
| `name` | text input | Yes | `campaign.name` |
| `status` | `<select>` (Draft / Active / Paused / Completed) | Yes | `campaign.status` |
| `target_count` | number input | No | `campaign.target_count` (or empty if 0) |
| `scheduled_at` | `datetime-local` input | No | `campaign.scheduled_at` (truncated to `YYYY-MM-DDTHH:mm`) |

**Change handlers:**
- Text/number inputs: `(e: React.ChangeEvent<HTMLInputElement>) => setForm(prev => ({ ...prev, field: e.target.value }))`
- `status` select: `(e: React.ChangeEvent<HTMLSelectElement>) => setForm(prev => ({ ...prev, status: e.target.value as FormState['status'] }))`

**Structure** (follows `add-campaign-modal.tsx`):
- `'use client'` directive at top
- Backdrop: `fixed inset-0 z-50 flex items-center justify-center bg-black/50`, click outside closes
- Dialog: `role="dialog" aria-modal="true" aria-label="Edit Campaign"`, `w-full max-w-md`
- Header: title "Edit Campaign" + X close button
- Body: form fields with labels, `htmlFor`/`id` pairs on all inputs and the select
- Footer: Cancel + submit button — label is `mutation.isPending ? 'Saving…' : 'Save Changes'`, disabled while pending

---

## `marketing/page.tsx` Changes

1. Add `const [editTarget, setEditTarget] = useState<Campaign | null>(null)`
2. Pass `onEdit={(c) => setEditTarget(c)}` to `<CampaignsList>`
3. Mount `<EditCampaignModal campaign={editTarget} onClose={() => setEditTarget(null)} onSuccess={handleSuccess} />`
4. `handleSuccess` already calls `queryClient.invalidateQueries({ queryKey: ['campaigns', tenantId] })` — no change needed

---

## Testing

New test file: `src/components/__tests__/edit-campaign-modal.test.tsx`

**Mocking:** Use `vi.hoisted()` for `mockMutateAsync` and `mockUseMutation` per CLAUDE.md Vitest gotcha. Export `ApiError` from the mock factory so `instanceof` works inside the component.

**Test campaign fixture:**
```ts
const mockCampaign: Campaign = {
  id: 'camp-1',
  tenant_id: 'tid',
  name: 'Summer Sale',
  status: 'draft',
  campaign_type: 'email',
  target_count: 500,
  sent_count: 0,
  scheduled_at: '2026-06-15T10:00:00.000Z',
  created_at: '2026-03-01T00:00:00.000Z',
  updated_at: '2026-03-01T00:00:00.000Z',
};
```

**Tests:**

1. **Returns null when `campaign` is null** — `queryByRole('dialog')` returns null
2. **Renders all 4 fields pre-filled** — name input has `mockCampaign.name`, status select shows `mockCampaign.status`, target_count input has `'500'`, scheduled_at input has the truncated datetime string
3. **Shows validation error on empty name** — clear name field, submit → inline error `'Name is required'` visible, `mockMutateAsync` not called
4. **Calls `updateCampaign` with correct payload on valid submit** — assert `mockMutateAsync` called with `{ name: 'Summer Sale', status: 'draft', target_count: 500, scheduled_at: '2026-06-15T10:00' }` (or null for empty scheduled_at)
5. **Calls `onSuccess` and `onClose` after successful mutation** — both called once after `mutateAsync` resolves
6. **Shows API error when mutation rejects with `ApiError`** — error text visible in the DOM
7. **Form re-initializes when `campaign` prop changes** — re-render with a different campaign object → name input reflects new campaign's name
