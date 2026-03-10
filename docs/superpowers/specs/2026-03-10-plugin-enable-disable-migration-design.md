# Plugin Enable/Disable — Full API with Soft Migration & Audit Log

**Date:** 2026-03-10
**Status:** Approved
**Scope:** Complete the `togglePlugin()` API with first-enable soft migration (BullMQ), audit logging, and userId tracking.

---

## Context

The existing `togglePlugin()` implementation (commit `1dac9f3`) handles:
- Dependency validation (HTTP 422 error-and-reject)
- `is_enabled` DB toggle + cache invalidation

Missing:
1. **Soft migration** — async init/seed job when a plugin is enabled for the first time for a tenant
2. **Audit log** — `plugin.enabled` / `plugin.disabled` events via `AmqpPublisher`
3. **userId** — who triggered the toggle (from JWT)

**Cascade behavior: unchanged.** Enable with missing deps → 422. Disable with enabled dependents → 422. No automatic cascade.

---

## Architecture

### Data Flow — Enable (first time)

```
togglePlugin(tenantId, pluginId, true, userId)
  → getMissingDeps check (existing)
  → INSERT tenant_plugins SET is_enabled=true
  → SELECT initialized_at for this row
  → initialized_at IS NULL → enqueue QUEUE_PLUGIN_INIT job
  → publishAudit('plugin.enabled', { initializing: true })
  → return { pluginId, enabled: true, initializing: true }

PluginInitProcessor (async, BullMQ)
  → re-fetch initialized_at (idempotency check)
  → already set? → return early
  → runInitFor(pluginId, tenantId) — per-plugin init logic
  → UPDATE tenant_plugins SET initialized_at = NOW()
```

### Data Flow — Enable (subsequent)

```
  → initialized_at IS NOT NULL → skip enqueue
  → publishAudit('plugin.enabled', { initializing: false })
  → return { pluginId, enabled: true, initializing: false }
```

### Data Flow — Disable

```
togglePlugin(tenantId, pluginId, false, userId)
  → getBlockingDependents check (existing)
  → UPDATE tenant_plugins SET is_enabled=false
  → publishAudit('plugin.disabled')
  → return { pluginId, enabled: false }
```

---

## Changes

### 1. DB Migration — `20260310000009_plugin_init`

```sql
ALTER TABLE tenant_plugins
  ADD COLUMN initialized_at TIMESTAMPTZ NULL;
```

No index needed — only accessed by `(tenant_id, plugin_name)` primary key.

### 2. Queue Constant

Add to `src/workers/bullmq/queue.constants.ts`:

```typescript
export const QUEUE_PLUGIN_INIT = 'plugin-init' as const;
```

### 3. PluginInitProcessor

New file: `src/workers/bullmq/processors/plugin-init.processor.ts`

```typescript
export interface PluginInitJobData {
  tenantId: string;
  pluginId: string;
}
```

- `@Processor(QUEUE_PLUGIN_INIT, { concurrency: 5 })`
- Injects `PoolRegistry` for metadata DB access
- Retry policy: 3 attempts, exponential backoff (consistent with `QUEUE_EMAIL`)
- **Idempotency**: re-fetches `initialized_at` before doing work — safe on BullMQ retry
- **Per-plugin init dispatch**: `switch(pluginId)` — Phase 5 all no-ops (log only)
- Sets `initialized_at = NOW()` on success

**Phase 5 init table:**

| Plugin | Init action |
|--------|------------|
| `customer-data` | no-op (log) |
| `customer-care` | no-op (log) |
| `analytics` | no-op (log) |
| `automation` | no-op (log) |
| `marketing` | no-op (log) |

The `switch` structure is the extension point for Phase 6 plugins to add real init logic.

**Self-healing**: if all 3 retries fail, `initialized_at` stays `NULL`. The next time the admin enables this plugin, the job will be enqueued again automatically.

### 4. BullMqModule Registration

Queue registration and processor providers live in `src/workers/bullmq/bullmq.module.ts` (not `workers.module.ts`):

- Add `QUEUE_PLUGIN_INIT` to `BullModule.registerQueue()`
- Add `PluginInitProcessor` to `providers`
- Inject `@InjectQueue(QUEUE_PLUGIN_INIT) private readonly pluginInitQueue: Queue` into `AdminTenantsService` constructor as the 9th argument

### 5. togglePlugin() — Updated Signature and Logic

```typescript
async togglePlugin(
  tenantId: string,
  pluginId: string,
  enabled: boolean,
  userId: string,           // ← new
): Promise<{ pluginId: string; enabled: boolean; initializing?: boolean }>
```

**Enable path changes:**
1. After INSERT, query `initialized_at` for this `(tenantId, pluginId)` row
2. If `NULL`: enqueue `QUEUE_PLUGIN_INIT` job, set `isFirstEnable = true`
3. Call `publishAudit` with `action: 'plugin.enabled'`
4. Return `{ pluginId, enabled: true, initializing: isFirstEnable }`

**Disable path changes:**
1. Call `publishAudit` with `action: 'plugin.disabled'`
2. Return `{ pluginId, enabled: false }` (no `initializing` field)

**No other changes** — dependency checks remain identical.

### 6. Audit Log Shape

Field names match the `AuditMessage` interface (`src/workers/dto/audit-message.dto.ts`):

```typescript
this.amqp.publishAudit({
  tenantId,
  userId,
  action: 'plugin.enabled' | 'plugin.disabled',
  resourceType: 'plugin',
  resourceId: pluginId,
  payload: { pluginId, initializing?: boolean },
  timestamp: new Date().toISOString(),
});
```

### 7. AdminTenantsController

Add `@CurrentUser() user: JwtClaims` to `togglePlugin` handler, pass `user.sub` as `userId`. No `TogglePluginDto` needed — use inline body type consistent with other handlers in this controller:

```typescript
async togglePlugin(
  @Param('tenantId') tenantId: string,
  @Param('pluginId') pluginId: string,
  @Body() body: { enabled: boolean },
  @CurrentUser() user: JwtClaims,
) {
  return this.tenantsService.togglePlugin(tenantId, pluginId, body.enabled, user.sub);
}
```

`@CurrentUser()` is imported from `src/gateway/decorators/current-tenant.decorator.ts`. `JwtClaims` from `src/gateway/dto/jwt-claims.dto.ts`.

---

## Files Changed

| File | Change |
|------|--------|
| `backend/src/db/migrations/20260310000009_plugin_init.ts` | New — adds `initialized_at` column |
| `backend/src/workers/bullmq/queue.constants.ts` | Add `QUEUE_PLUGIN_INIT` |
| `backend/src/workers/bullmq/processors/plugin-init.processor.ts` | New processor |
| `backend/src/workers/bullmq/bullmq.module.ts` | Register `QUEUE_PLUGIN_INIT` + `PluginInitProcessor` |
| `backend/src/api/v1/admin/tenants/admin-tenants.service.ts` | Add `userId` param, init enqueue, audit log, inject queue |
| `backend/src/api/v1/admin/tenants/admin-tenants.controller.ts` | Pass `user.sub` to service |
| `backend/src/api/v1/admin/tenants/__tests__/admin-tenants.service.test.ts` | Update togglePlugin tests |

---

## Non-Goals

- Cascade enable (auto-enable dependencies) — explicitly excluded
- Real init logic for Phase 5 plugins — no-op is correct; tables already exist
- Plugin disable cleanup job — out of scope

---

## Critical Constraints (from CLAUDE.md)

- `QueryInterceptor` scopes all Knex queries automatically — do NOT add `WHERE tenant_id = ?` in `PluginInitProcessor`; use raw `client.query()` with explicit `tenant_id` parameter since the processor runs outside request context (no `TenantContext`)
- `PluginInitProcessor` is registered in `BullMqModule.providers`. `WorkersModule` does NOT export `BullMqModule` — only `AmqpModule` is exported. The queue `@InjectQueue(QUEUE_PLUGIN_INIT)` in `AdminTenantsService` resolves because `ApiModule` (which owns `AdminTenantsService`) must import `BullMqModule` — verify this wiring when implementing.
