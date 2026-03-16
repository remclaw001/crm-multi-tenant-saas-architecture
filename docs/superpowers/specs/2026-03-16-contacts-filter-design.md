# Contacts Filter Design

**Date:** 2026-03-16
**Status:** Approved

## Problem

The contacts list (`GET /api/v1/plugins/customer-data/customers`) returns all active contacts with no filtering. Users must scroll through all contacts to find one matching specific criteria. There is no way to filter by name, company, phone, or status from the UI.

## Solution

Add server-side filtering to the contacts list. The backend accepts optional query params (`name`, `company`, `phone`, `status`); the frontend renders a filter row above the contacts table with four inputs and submits on Enter / Search button click.

## Scope

- **Backend:** `customer-data` plugin controller + core service.
- **Frontend:** `api-client.ts` + `contacts/page.tsx`.
- **No new components** — filter inputs are inline in the page.
- **No schema changes** — filters operate on existing columns.

## Data Flow

```
contacts/page.tsx
  → form state: { name, company, phone, status }
  → on Enter / Search click → setActiveFilter(formState)
  → useQuery key: ['customers', tenantId, activeFilter]
  → crmApi.getCustomers(ctx, activeFilter)
  → GET /api/v1/plugins/customer-data/customers?name=&company=&phone=&status=
  → CustomerDataController.listCustomers(@Query params)
  → CustomerDataCore.listCustomers(ctx, filter)
  → Knex query with conditional WHERE clauses
```

## Backend Changes

### `CustomerDataController` (`customer-data.controller.ts`)

Add `Query` to the existing `@nestjs/common` import (alongside `Get`, `Req`, etc.), then add `@Query()` parameters to `listCustomers`:

```ts
@Get('customers')
async listCustomers(
  @Query('name')    name?: string,
  @Query('company') company?: string,
  @Query('phone')   phone?: string,
  @Query('status')  status?: 'active' | 'inactive' | 'all',
  @CurrentTenant() tenant: ResolvedTenant,
  @CurrentUser()   user: JwtClaims,
  @Req()           req: Request & { correlationId?: string },
) {
  const ctx = await this.buildCtx(tenant, user, req);
  const filter = { name, company, phone, status };
  const customers = await this.sandbox.execute(
    () => this.core.listCustomers(ctx, filter),
    this.core.manifest.limits.timeoutMs,
  );
  return { plugin: PLUGIN_NAME, data: customers, count: customers.length };
}
```

### `CustomerDataCore` (`customer-data.core.ts`)

Add `ListCustomersFilter` interface and update `listCustomers`:

```ts
export interface ListCustomersFilter {
  name?:    string;
  company?: string;
  phone?:   string;
  status?:  'active' | 'inactive' | 'all';
}

async listCustomers(ctx: IExecutionContext, filter: ListCustomersFilter = {}): Promise<Customer[]> {
  let query = ctx.db
    .db('customers')
    .select('id', 'tenant_id', 'name', 'email', 'phone', 'company', 'is_active', 'created_at', 'updated_at');

  // Status filter — default behaviour: active only
  if (!filter.status || filter.status === 'active') {
    query = query.where('is_active', true);
  } else if (filter.status === 'inactive') {
    query = query.where('is_active', false);
  }
  // 'all' → no is_active condition

  if (filter.name)    query = query.where('name',    'ilike', `%${filter.name}%`);
  if (filter.company) query = query.where('company', 'ilike', `%${filter.company}%`);
  if (filter.phone)   query = query.where('phone',   'ilike', `%${filter.phone}%`);

  return query.orderBy('created_at', 'desc').limit(100) as Promise<Customer[]>;
}
```

**Matching rules:**
- `name`, `company`, `phone` — case-insensitive partial match (`ILIKE '%value%'`). Empty string or omitted = no filter applied.
- `status: 'active'` (default) → `is_active = true`; `'inactive'` → `is_active = false`; `'all'` → no `is_active` condition.

## Frontend Changes

### `api-client.ts`

Add `CustomerFilter` type and update `getCustomers`:

```ts
export interface CustomerFilter {
  name?:    string;
  company?: string;
  phone?:   string;
  status?:  'active' | 'inactive' | 'all';
}

getCustomers(ctx: AuthCtx, filter?: CustomerFilter): Promise<PluginListResponse<Customer>> {
  const params = new URLSearchParams();
  const name    = filter?.name?.trim()    ?? '';
  const company = filter?.company?.trim() ?? '';
  const phone   = filter?.phone?.trim()   ?? '';
  if (name)           params.set('name',    name);
  if (company)        params.set('company', company);
  if (phone)          params.set('phone',   phone);
  if (filter?.status) params.set('status',  filter.status);
  const qs = params.toString();
  return request(
    `/api/v1/plugins/customer-data/customers${qs ? `?${qs}` : ''}`,
    ctx,
  );
}
```

Text values are **trimmed** in `getCustomers` before being added to the query string. Only non-empty trimmed values are included as query params. No `status` param = backend defaults to active only.

### `contacts/page.tsx`

Add filter form state and wiring:

```tsx
// Form state (what the user is currently typing)
const [filterForm, setFilterForm] = useState({
  name: '', company: '', phone: '', status: 'active' as 'active' | 'inactive' | 'all',
});

// Submitted filter (what triggers the actual API call)
const [activeFilter, setActiveFilter] = useState<CustomerFilter>({ status: 'active' });

const { data, isLoading } = useQuery({
  queryKey: ['customers', tenantId, activeFilter],
  queryFn:  () => crmApi.getCustomers({ token, tenantId }, activeFilter),
  enabled:  !!token && !!tenantId,
});

function handleSubmit(e?: React.FormEvent) {
  e?.preventDefault();
  setActiveFilter({ ...filterForm });
}

function handleReset() {
  const defaults = { name: '', company: '', phone: '', status: 'active' as const };
  setFilterForm(defaults);
  setActiveFilter({ status: 'active' });
}
```

**Filter row JSX** (rendered above the contacts table, inside a `<form onSubmit={handleSubmit}>`):

```tsx
<form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted/30 p-3">
  <div className="flex flex-col gap-1">
    <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Name</label>
    <input
      type="text"
      value={filterForm.name}
      onChange={(e) => setFilterForm((f) => ({ ...f, name: e.target.value }))}
      placeholder="e.g. Nguyen…"
      className="w-32 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
    />
  </div>
  <div className="flex flex-col gap-1">
    <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Company</label>
    <input
      type="text"
      value={filterForm.company}
      onChange={(e) => setFilterForm((f) => ({ ...f, company: e.target.value }))}
      placeholder="e.g. Acme…"
      className="w-32 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
    />
  </div>
  <div className="flex flex-col gap-1">
    <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Phone</label>
    <input
      type="text"
      value={filterForm.phone}
      onChange={(e) => setFilterForm((f) => ({ ...f, phone: e.target.value }))}
      placeholder="e.g. 0912…"
      className="w-28 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
    />
  </div>
  <div className="flex flex-col gap-1">
    <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</label>
    <select
      value={filterForm.status}
      onChange={(e) => {
        const status = e.target.value as 'active' | 'inactive' | 'all';
        // Merge current form state (including unsaved text) + new status → submit immediately
        setFilterForm((f) => {
          const updated = { ...f, status };
          setActiveFilter(updated);
          return updated;
        });
      }}
      className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
    >
      <option value="active">Active</option>
      <option value="inactive">Inactive</option>
      <option value="all">All</option>
    </select>
  </div>
  <div className="flex gap-2">
    <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
      Search
    </button>
    <button type="button" onClick={handleReset} className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground">
      Reset
    </button>
  </div>
</form>
```

**Trigger rules:**
- Press Enter in any text input → form submit → `setActiveFilter`
- Click **Search** button → form submit → `setActiveFilter`
- Change Status dropdown → merges **current `filterForm` state** (including any unsaved text) + new status into `activeFilter` immediately. This means any text already typed in the text inputs is also submitted at that moment.
- Click **Reset** → clear form + reset `activeFilter` to `{ status: 'active' }`

## Edge Cases

| Scenario | Behaviour |
|---|---|
| All text filters empty, status = Active | Returns all active contacts (same as current default) |
| Filter value is whitespace only | Trimmed to empty string before submission → treated as no filter for that field |
| User types `%` or `_` in a text field | These are SQL `ILIKE` wildcards and will be passed through as-is (`%` matches anything, `_` matches one character). This is acceptable; not a security issue (Knex parameterises the value) but users can exploit it for broader searches. |
| `phone` or `company` is NULL in DB | `ILIKE` on NULL returns no match — contacts with null phone/company won't appear when that filter is active |
| Reset | Clears text fields, sets Status back to Active, re-fetches |
| Status dropdown changed while text is typed but not submitted | The dropdown change submits the entire current `filterForm` (including unsaved text) as `activeFilter` — text filters take effect immediately alongside the status change |
| Contact added/edited while filter active | `invalidateQueries({ queryKey: ['customers', tenantId] })` invalidates all queries with that prefix; next refetch re-applies current `activeFilter` |
| `email` filter | Out of scope for this iteration. Email is not exposed as a filter field. |

## Testing

### Backend unit tests (`customer-data.core.test.ts`)
- No filter → returns only `is_active = true` rows
- `status: 'inactive'` → returns only `is_active = false` rows
- `status: 'all'` → returns both active and inactive
- `name: 'nguyen'` → returns only rows where name ILIKE `%nguyen%`
- `company: 'acme'` → filters by company
- `phone: '0912'` → filters by phone
- Multiple filters combined → all conditions applied (AND logic)

### Frontend unit tests (`contacts.page.test.tsx` or similar)
- Filter form renders with correct initial state (Status = Active)
- Pressing Enter in name input triggers `getCustomers` with updated filter
- Changing status dropdown triggers `getCustomers` immediately
- Reset button clears form and re-fetches with `{ status: 'active' }`
- Search button submits current form state

## Files Changed

| File | Change |
|---|---|
| `backend/src/plugins/cores/customer-data/customer-data.controller.ts` | Add `@Query()` params; pass `filter` to `core.listCustomers` |
| `backend/src/plugins/cores/customer-data/customer-data.core.ts` | Add `ListCustomersFilter` interface; update `listCustomers` with conditional WHERE clauses |
| `frontend/web/src/lib/api-client.ts` | Add `CustomerFilter` type; update `getCustomers` to build query string |
| `frontend/web/src/app/(plugins)/contacts/page.tsx` | Add filter form state + `<form>` row above contacts table |
