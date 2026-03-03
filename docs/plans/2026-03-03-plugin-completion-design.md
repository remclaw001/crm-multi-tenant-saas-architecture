# Plugin Completion Design — Group A + B

**Date:** 2026-03-03
**Scope:** customer-data (full CRUD) + customer-care (real DB)
**Status:** Approved

---

## Context

The CRM has 5 built-in plugins. Two are currently implemented with real DB queries
(`customer-data` reads from `users`, `analytics` reads from `users`). Three are
placeholders returning hardcoded data (`customer-care`, `automation`, `marketing`).

This design covers completing **Group A** (customer-data full CRUD) and **Group B**
(customer-care real DB) in a single implementation pass.

---

## Key Decisions

| Decision | Choice | Reason |
|---|---|---|
| Contact model | Separate `customers` table | `users` = employees/admins who login; `customers` = CRM contacts who don't |
| API naming | Rename to "customers" everywhere | Semantic alignment with DB; no backward compat concern in learning project |
| Delete strategy | Soft delete (`is_active = false`) | cases FK → customers; hard delete would cascade-destroy case history |
| RLS | Enabled + Forced on both tables | Matches existing project pattern; double safety with QueryInterceptor |
| Validation | Lightweight in core (no class-validator) | Consistent with existing plugin core pattern |

---

## Section 1: Database Schema

### Migration: `customers` table

File: `backend/src/db/migrations/20260303000004_customers.ts`

```
customers
  id           UUID PK     DEFAULT uuid_generate_v4()
  tenant_id    UUID NN      → tenants(id) ON DELETE CASCADE
  email        VARCHAR(255) NN
  name         VARCHAR(255) NN
  phone        VARCHAR(50)  NULLABLE
  is_active    BOOLEAN NN   DEFAULT true
  created_at   TIMESTAMPTZ  DEFAULT NOW()
  updated_at   TIMESTAMPTZ  DEFAULT NOW()

Constraints:
  UNIQUE(tenant_id, email)

Indexes:
  idx_customers_tenant_id
  idx_customers_tenant_email (unique)

RLS:
  ENABLE ROW LEVEL SECURITY
  FORCE ROW LEVEL SECURITY
  POLICY tenant_isolation:
    USING     (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
```

### Migration: `cases` table

File: `backend/src/db/migrations/20260303000005_cases.ts`

```
cases
  id           UUID PK     DEFAULT uuid_generate_v4()
  tenant_id    UUID NN      → tenants(id) ON DELETE CASCADE
  customer_id  UUID NN      → customers(id) ON DELETE CASCADE
  subject      VARCHAR(500) NN
  description  TEXT         NULLABLE
  status       VARCHAR(20)  NN DEFAULT 'open'
               -- enum: open | in-progress | resolved
  priority     VARCHAR(20)  NN DEFAULT 'medium'
               -- enum: low | medium | high | urgent
  created_by   UUID NN      → users(id)
  created_at   TIMESTAMPTZ  DEFAULT NOW()
  updated_at   TIMESTAMPTZ  DEFAULT NOW()

Indexes:
  idx_cases_tenant_id
  idx_cases_tenant_customer   (tenant_id, customer_id) — "all cases for customer X"
  idx_cases_tenant_status     (tenant_id, status)      — "all open cases"

RLS:
  ENABLE ROW LEVEL SECURITY
  FORCE ROW LEVEL SECURITY
  POLICY tenant_isolation (same pattern as customers)
```

---

## Section 2: API Routes

### Group A — customer-data plugin

| Method | Route | Core Method | Notes |
|---|---|---|---|
| GET | `/api/v1/plugins/customer-data/customers` | `listCustomers` | is_active=true only |
| GET | `/api/v1/plugins/customer-data/customers/:id` | `getCustomer` | 404 if not found |
| POST | `/api/v1/plugins/customer-data/customers` | `createCustomer` | email unique per tenant |
| PUT | `/api/v1/plugins/customer-data/customers/:id` | `updateCustomer` | 404 if not found |
| DELETE | `/api/v1/plugins/customer-data/customers/:id` | `deleteCustomer` | soft delete only |

**Request bodies:**
```typescript
// POST /customers
{ email: string, name: string, phone?: string }

// PUT /customers/:id
{ name?: string, phone?: string, is_active?: boolean }
```

### Group B — customer-care plugin

| Method | Route | Core Method | Notes |
|---|---|---|---|
| GET | `/api/v1/plugins/customer-care/cases` | `listCases` | JOINs customer name |
| GET | `/api/v1/plugins/customer-care/cases/:id` | `getCase` | 404 if not found |
| POST | `/api/v1/plugins/customer-care/cases` | `createCase` | validates customer_id exists |
| PATCH | `/api/v1/plugins/customer-care/cases/:id` | `updateCase` | status + priority only |

**Request bodies:**
```typescript
// POST /cases
{ customer_id: string, subject: string, description?: string, priority?: 'low'|'medium'|'high'|'urgent' }

// PATCH /cases/:id
{ status?: 'open'|'in-progress'|'resolved', priority?: 'low'|'medium'|'high'|'urgent' }
```

**Response format** — consistent with existing pattern:
```json
{ "plugin": "customer-data", "data": { ... } }
{ "plugin": "customer-data", "data": [ ... ], "count": 3 }
```

---

## Section 3: Core Methods

### CustomerDataCore (full rewrite)

```typescript
// reads from: customers table
listCustomers(ctx)              → SELECT * WHERE is_active=true ORDER BY created_at DESC LIMIT 100
getCustomer(ctx, id)            → SELECT WHERE id=? → Customer | null
createCustomer(ctx, input)      → validate email format → INSERT → return new row
updateCustomer(ctx, id, input)  → UPDATE SET ...fields WHERE id=? → return updated row | null
deleteCustomer(ctx, id)         → UPDATE SET is_active=false, updated_at=NOW() WHERE id=?
```

Validation in `createCustomer`: basic email regex check, throw `ValidationError` if invalid.

### CustomerCareCore (replace placeholders)

```typescript
// reads from: cases JOIN customers
listCases(ctx)              → SELECT cases.*, customers.name as customer_name ORDER BY created_at DESC
getCase(ctx, id)            → SELECT ... WHERE cases.id=? → Case | null
createCase(ctx, input)      → verify customer_id exists in tenant → INSERT → return new row
updateCase(ctx, id, input)  → UPDATE SET status/priority, updated_at=NOW() WHERE id=? → return updated | null
```

Validation in `createCase`: SELECT customer by `customer_id` first; throw `ResourceNotFoundError` if not found.

---

## Section 4: Seed Data

New seed files to support development testing:

- `03_customers.ts` — 3–5 sample customers per tenant (name, email, phone)
- `04_cases.ts` — 3–5 sample cases per tenant referencing seeded customers

---

## Files Affected

### New files
- `backend/src/db/migrations/20260303000004_customers.ts`
- `backend/src/db/migrations/20260303000005_cases.ts`
- `backend/src/db/seeds/03_customers.ts`
- `backend/src/db/seeds/04_cases.ts`

### Modified files
- `backend/src/plugins/cores/customer-data/customer-data.core.ts` — full rewrite
- `backend/src/plugins/cores/customer-data/customer-data.controller.ts` — add 3 new routes
- `backend/src/plugins/cores/customer-care/customer-care.core.ts` — replace placeholders
- `backend/src/plugins/cores/customer-care/customer-care.controller.ts` — add GET/:id + PATCH

### No changes needed
- Migrations 1–3 (existing schema untouched)
- SandboxService, ExecutionContextBuilder, HookRegistry
- analytics, automation, marketing plugins
- Gateway, DAL, Observability layers
