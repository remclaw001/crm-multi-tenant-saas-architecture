# Plugin Completion Design

**Date:** 2026-03-03
**Scope:** Complete all 5 built-in plugin cores — real DB-backed CRUD, hook wiring, full unit tests.
**Status:** Approved

---

## Context

The system has 5 plugin cores. Two have real DB queries; three return hardcoded stubs.

| Plugin | Status Before | Target |
|---|---|---|
| `customer-data` | Read-only (list, get — on `users`) | Full CRUD on `customers` table + hooks |
| `analytics` | Implemented (summary, trends on `users`) | Update to aggregate on `customers` |
| `customer-care` | Stubbed | Full CRUD on `support_cases` |
| `automation` | Stubbed | Full CRUD on `automation_triggers` |
| `marketing` | Stubbed | Full CRUD on `marketing_campaigns` |

### Domain Model Clarification

| Table | Purpose | Auth |
|---|---|---|
| `users` | Employees, sales reps, admins — **internal staff** of a tenant | JWT login with `password_hash` |
| `customers` | CRM contacts managed by the tenant — **external parties** | No login |

Previously `customer-data` incorrectly read from `users`. All customer/contact operations move to a new dedicated `customers` table.

---

## Key Decisions

| Decision | Choice | Reason |
|---|---|---|
| Contact model | Separate `customers` table | `users` = staff who login; `customers` = CRM contacts who don't |
| API naming | `/customers` everywhere (not `/contacts`) | Matches table name; no backward-compat concern in learning project |
| Delete strategy for customers | Soft delete (`is_active = false`) | FK chains (cases → customers) would break on hard delete |
| Delete strategy for cases/triggers/campaigns | Hard delete | No downstream dependencies |
| RLS | FORCE on all new tables | Consistent with existing pattern; double safety with QueryInterceptor |
| Validation | Lightweight in core (no class-validator DTOs) | Matches existing plugin core pattern; Phase 6 adds full validation |
| Hook handlers (Phase 5) | No-op + log | Infrastructure wired correctly; business logic deferred to Phase 7+ |

---

## Section 1: Database Schema

Single migration file: `backend/src/db/migrations/20260303000004_plugin_tables.ts`

### Table: `customers`

```
id          UUID        PK   DEFAULT gen_random_uuid()
tenant_id   UUID        NN   FK → tenants(id) ON DELETE CASCADE
email       TEXT             NULLABLE
name        TEXT        NN
phone       TEXT             NULLABLE
company     TEXT             NULLABLE
is_active   BOOLEAN     NN   DEFAULT true
created_at  TIMESTAMPTZ      DEFAULT NOW()
updated_at  TIMESTAMPTZ      DEFAULT NOW()
```

- RLS FORCE: `tenant_id = current_setting('app.tenant_id', true)::uuid`
- Indexes: `(tenant_id)`, `(tenant_id, email) WHERE email IS NOT NULL`

### Table: `support_cases`

```
id           UUID        PK   DEFAULT gen_random_uuid()
tenant_id    UUID        NN   FK → tenants(id)
customer_id  UUID        NN   FK → customers(id) ON DELETE CASCADE
title        TEXT        NN
status       TEXT        NN   DEFAULT 'open'   -- open | in_progress | resolved | closed
priority     TEXT        NN   DEFAULT 'medium' -- low | medium | high
assigned_to  UUID             NULLABLE FK → users(id)  -- internal staff member
description  TEXT             NULLABLE
resolved_at  TIMESTAMPTZ      NULLABLE
created_at   TIMESTAMPTZ      DEFAULT NOW()
updated_at   TIMESTAMPTZ      DEFAULT NOW()
```

- RLS FORCE on `tenant_id`
- Indexes: `(tenant_id, status)`, `(tenant_id, customer_id)`
- `assigned_to` → FK to `users` (an internal employee, never a customer)

### Table: `automation_triggers`

```
id          UUID        PK   DEFAULT gen_random_uuid()
tenant_id   UUID        NN   FK → tenants(id)
name        TEXT        NN
event_type  TEXT        NN   -- e.g. 'customer.create', 'case.open'
conditions  JSONB            DEFAULT '{}'
actions     JSONB            DEFAULT '[]'
is_active   BOOLEAN     NN   DEFAULT true
created_at  TIMESTAMPTZ      DEFAULT NOW()
updated_at  TIMESTAMPTZ      DEFAULT NOW()
```

- RLS FORCE on `tenant_id`
- Indexes: `(tenant_id, is_active)`, `(tenant_id, event_type)`

### Table: `marketing_campaigns`

```
id             UUID        PK   DEFAULT gen_random_uuid()
tenant_id      UUID        NN   FK → tenants(id)
name           TEXT        NN
status         TEXT        NN   DEFAULT 'draft' -- draft | active | paused | completed
campaign_type  TEXT        NN   DEFAULT 'email' -- email | sms
target_count   INTEGER          DEFAULT 0
sent_count     INTEGER          DEFAULT 0
scheduled_at   TIMESTAMPTZ      NULLABLE
created_at     TIMESTAMPTZ      DEFAULT NOW()
updated_at     TIMESTAMPTZ      DEFAULT NOW()
```

- RLS FORCE on `tenant_id`
- Index: `(tenant_id, status)`

---

## Section 2: API Routes

### `customer-data` — `/api/v1/plugins/customer-data/customers`

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/customers` | — | List active customers; ORDER BY created_at DESC |
| GET | `/customers/:id` | — | Single customer or ResourceNotFoundError |
| POST | `/customers` | `{ name, email?, phone?, company? }` | Insert + fire `customer.create` hooks |
| PUT | `/customers/:id` | `{ name?, email?, phone?, company?, is_active? }` | Partial update |
| DELETE | `/customers/:id` | — | Soft delete: `is_active = false` |

### `customer-care` — `/api/v1/plugins/customer-care/cases`

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/cases` | — | List cases; JOIN customers for customer name |
| GET | `/cases/:id` | — | Single case or ResourceNotFoundError |
| POST | `/cases` | `{ customer_id, title, priority?, description? }` | Verify customer_id exists first |
| PUT | `/cases/:id` | `{ status?, priority?, assigned_to?, description? }` | Partial update; set resolved_at when status→resolved |
| DELETE | `/cases/:id` | — | Hard delete |

### `automation` — `/api/v1/plugins/automation/triggers`

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/triggers` | — | List triggers |
| GET | `/triggers/:id` | — | Single trigger or ResourceNotFoundError |
| POST | `/triggers` | `{ name, event_type, conditions?, actions?, is_active? }` | Create trigger |
| PUT | `/triggers/:id` | `{ name?, event_type?, conditions?, actions?, is_active? }` | Partial update |
| DELETE | `/triggers/:id` | — | Hard delete |

### `marketing` — `/api/v1/plugins/marketing/campaigns`

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/campaigns` | — | List campaigns |
| GET | `/campaigns/:id` | — | Single campaign or ResourceNotFoundError |
| POST | `/campaigns` | `{ name, campaign_type?, scheduled_at? }` | Create campaign |
| PUT | `/campaigns/:id` | `{ name?, status?, target_count?, scheduled_at? }` | Partial update |
| DELETE | `/campaigns/:id` | — | Hard delete |

### `analytics` — update queries

`GET /api/v1/plugins/analytics/reports/:type` — same routes unchanged. Update `summary` and
`trends` core methods to query `customers` table instead of `users`.

---

## Section 3: Hook Wiring

### Event: `customer.create`

Fired from `CustomerDataCore.createCustomer()`. Execution order:

```
POST /customers
  │
  ├─ 1. hookRegistry.runBefore('customer.create', ctx, input)
  │     └─ automation (priority=5)  — inspect trigger rules, may enrich input
  │
  ├─ 2. INSERT INTO customers (...)
  │
  └─ 3. hookRegistry.runAfter('customer.create', ctx, newCustomer)
        └─ customer-care (priority=10)  — may auto-create an onboarding case
```

**Implementation in `CustomerDataCore.createCustomer()`:**

```typescript
async createCustomer(ctx: IExecutionContext, input: CreateCustomerInput): Promise<Customer> {
  await this.hookRegistry.runBefore('customer.create', ctx, input);
  const [customer] = await ctx.db.db('customers').insert({
    tenant_id: ctx.tenantId,
    ...input,
  }).returning('*');
  await this.hookRegistry.runAfter('customer.create', ctx, customer);
  return customer;
}
```

**Hook handlers in Phase 5:** Both `AutomationCore` and `CustomerCareCore` register no-op handlers
that log the event. The infrastructure is correctly wired; business logic (workflow engine,
auto-case creation) is deferred to Phase 7+.

`HookRegistryService` is injected via `PluginInfraModule` global DI — passed into cores that
need it through their module providers.

---

## Section 4: Testing Strategy

New test files in `backend/src/plugins/__tests__/`, following the existing `sandbox.test.ts`
and `hook-registry.test.ts` patterns: `vi.mock` for DB, mock Knex builder chain, mock CacheManager.

| File | Methods covered |
|---|---|
| `customer-data.core.test.ts` | `listCustomers`, `getCustomer`, `createCustomer` (hook call order verified), `updateCustomer`, `deleteCustomer` (soft delete assertion) |
| `customer-care.core.test.ts` | `listCases`, `getCase`, `createCase` (customer_id validation), `updateCase` (resolved_at side-effect), `deleteCase` |
| `automation.core.test.ts` | `listTriggers`, `getTrigger`, `createTrigger`, `updateTrigger`, `deleteTrigger` |
| `marketing.core.test.ts` | `listCampaigns`, `getCampaign`, `createCampaign`, `updateCampaign`, `deleteCampaign` |
| `analytics.core.test.ts` (update) | `summary` and `trends` now query `customers`; update mocks accordingly |

**Coverage requirements per test:**
- Happy path: correct return shape
- Not found: `ResourceNotFoundError` thrown
- Hook call order for `createCustomer`: `runBefore` → insert → `runAfter` (use `vi.fn()` + call order assertion)
- DB error propagation: errors from Knex bubble up unchanged

---

## Files Affected

### New files

```
backend/src/db/migrations/20260303000004_plugin_tables.ts
backend/src/plugins/cores/customer-data/dto/create-customer.dto.ts
backend/src/plugins/cores/customer-data/dto/update-customer.dto.ts
backend/src/plugins/cores/customer-care/dto/create-case.dto.ts
backend/src/plugins/cores/customer-care/dto/update-case.dto.ts
backend/src/plugins/cores/automation/dto/create-trigger.dto.ts
backend/src/plugins/cores/automation/dto/update-trigger.dto.ts
backend/src/plugins/cores/marketing/dto/create-campaign.dto.ts
backend/src/plugins/cores/marketing/dto/update-campaign.dto.ts
backend/src/plugins/__tests__/customer-data.core.test.ts
backend/src/plugins/__tests__/customer-care.core.test.ts
backend/src/plugins/__tests__/automation.core.test.ts
backend/src/plugins/__tests__/marketing.core.test.ts
```

### Modified files

```
backend/src/plugins/cores/customer-data/customer-data.core.ts   — full rewrite (customers table, hooks)
backend/src/plugins/cores/customer-data/customer-data.controller.ts — add POST/PUT/DELETE routes
backend/src/plugins/cores/customer-data/customer-data.module.ts  — inject HookRegistryService
backend/src/plugins/cores/customer-care/customer-care.core.ts   — replace stubs with real queries
backend/src/plugins/cores/customer-care/customer-care.controller.ts — add GET/:id + PUT + DELETE
backend/src/plugins/cores/automation/automation.core.ts         — replace stubs + register hook handler
backend/src/plugins/cores/automation/automation.controller.ts   — add GET/:id + PUT + DELETE
backend/src/plugins/cores/marketing/marketing.core.ts           — replace stubs with real queries
backend/src/plugins/cores/marketing/marketing.controller.ts     — add GET/:id + PUT + DELETE
backend/src/plugins/cores/analytics/analytics.core.ts           — update queries to customers table
backend/src/plugins/__tests__/analytics.core.test.ts            — update mocks (if exists)
```

### Unchanged

- Migrations 1–3 (existing schema untouched)
- `users` table and auth flow
- `SandboxService`, `ExecutionContextBuilder`, `HookRegistry` infrastructure
- Gateway, DAL, Observability, Workers layers
