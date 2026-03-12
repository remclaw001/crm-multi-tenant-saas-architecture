# Event Registry — Design Spec

**Date:** 2026-03-12
**Status:** Approved

## Problem

The automation plugin currently detects events (e.g. `customer.create`) via `HookRegistryService`. This couples automation to specific hook names in code — `AutomationCore.onModuleInit()` hard-codes which events it listens to. Adding a new trigger event requires modifying automation internals.

Hooks serve a different purpose: inter-plugin code intervention (run logic before/after another plugin's operation). Using hooks as automation triggers conflates two concerns.

## Goal

- Any plugin declares the events it can produce via a typed registry
- Any plugin fires events via `eventRegistry.emit()` — no knowledge of who consumes
- Automation plugin subscribes to all events through a BullMQ queue — no knowledge of specific event names in code
- Hooks are preserved for explicit in-process code intervention between plugins

## Architecture

### New module: `EventInfraModule`

Located at `src/plugins/events/`. Marked `@Global()` so `EventRegistryService` is available everywhere without explicit imports.

Contains:

- `EventRegistryService` — in-memory registry of event definitions + `emit()` that INSERTs to `plugin_events` table
- `EventPollerService` — cron every 5s, polls `plugin_events` pending rows → enqueues to `QUEUE_PLUGIN_EVENTS`
- `BullModule.registerQueue(QUEUE_PLUGIN_EVENTS)` — queue registration scoped to this module (for `@InjectQueue` in `EventPollerService`)

`PluginInfraModule` imports and re-exports `EventInfraModule` to guarantee it initialises before plugin cores call `register()` in their `onModuleInit()`.

`AutomationModule` separately imports `BullModule.registerQueue(QUEUE_PLUGIN_EVENTS)` for its `@Processor` binding — this is the established pattern (same as `QUEUE_AUTOMATION_ACTIONS` is registered in both `WorkersModule` and `AutomationModule`).

### New method: `ExecutionContextBuilder.buildForWorker()`

`ExecutionContextBuilder.build(tenant, user, requestId)` requires `ResolvedTenant` and `JwtClaims`, which are not available in a BullMQ worker. A new overload is added:

```typescript
async buildForWorker(
  tenantId: string,
  tenantTier: string,
  requestId: string,
): Promise<ExecutionContext>
```

This constructs an `ExecutionContext` using `tenantId` and `tenantTier` directly (from the job payload), fetches `enabledPlugins` via `PluginRegistryService`, and supplies the standard `db` (QueryInterceptor-wrapped Knex) and `cache`. The resulting context is functionally equivalent for business logic queries.

### Data flow

```
Plugin.emit('customer.create', ctx, data)
  → EventRegistryService.emit()
      → Zod validate data against registered schema
      → INSERT plugin_events (status=pending, expires_at=NOW()+7days)
              ↓
EventPollerService (cron 5s, EventInfraModule)
  → SELECT p.*, t.tier AS tenant_tier
    FROM plugin_events p JOIN tenants t ON t.id = p.tenant_id
    WHERE p.status='pending' AND p.expires_at > NOW()
    FOR UPDATE OF p SKIP LOCKED LIMIT 50
  → UPDATE plugin_events SET status='queued', queued_at=NOW()
  → queue.add(QUEUE_PLUGIN_EVENTS, { eventId, eventName, tenantId, tenantTier, payload })
              ↓
AutomationEventProcessor (@Processor QUEUE_PLUGIN_EVENTS, AutomationModule)
  → TenantContext.run({ tenantId, tenantTier })
  → ctx = await executionContextBuilder.buildForWorker(tenantId, tenantTier, eventId)
  → automationCore.fireTriggerEvents(ctx, eventName, payload)
      → ctx.db.db('automation_triggers') ...   ← QueryInterceptor scoped
      → ctx.db.db('automation_action_events').insert(rows)   ← QueryInterceptor scoped
  → knex('plugin_events').where({ id: eventId }).update({ status: 'processed' })
    ← raw Knex for infra table (no RLS, no tenant scoping needed — same pattern as AutomationActionProcessor)
              ↓
AutomationActionPoller → QUEUE_AUTOMATION_ACTIONS → AutomationActionProcessor
  (unchanged)
```

### EventDefinition interface

```typescript
// src/plugins/events/event-definition.interface.ts
interface EventDefinition<T extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;         // e.g. 'customer.create'
  plugin: string;       // e.g. 'customer-data'
  description: string;
  schema: T;            // Zod schema — validates emit() payload + derives UI fields
}
```

### EventRegistryService

```typescript
class EventRegistryService {
  register(def: EventDefinition): void
  emit(eventName: string, ctx: IExecutionContext, data: unknown): Promise<void>
  getDefinitions(): EventDefinition[]   // returns all registered definitions
  getDefinition(name: string): EventDefinition | undefined
}
```

- `register()` — called in each plugin core's `onModuleInit()`; in-memory Map, not persisted
- `emit()` — Zod-validates payload (throws on schema mismatch or unknown event), INSERTs to `plugin_events`
- `getDefinitions()` — returns all definitions; **filtering by tenant's enabled plugins happens at the controller layer**, not here

### DB migration: `plugin_events`

```sql
CREATE TABLE plugin_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL,
  event_name  TEXT        NOT NULL,
  plugin      TEXT        NOT NULL,
  payload     JSONB       NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'pending',  -- pending | queued | processed
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  queued_at   TIMESTAMPTZ,           -- set when status → queued; used by stuck-row recovery
  expires_at  TIMESTAMPTZ NOT NULL
);

-- Covers poller: WHERE status='pending' AND expires_at > NOW()
CREATE INDEX ON plugin_events (status, expires_at) WHERE status = 'pending';
-- Covers stuck-row recovery: WHERE status='queued' AND queued_at < threshold
CREATE INDEX ON plugin_events (status, queued_at) WHERE status = 'queued';
```

No RLS. `tenant_tier` is NOT stored in `plugin_events` — the poller JOINs `tenants` at poll time (avoids denormalization, data is always fresh).

TTL: 7 days. EventPollerService skips rows where `expires_at < NOW()`. Cleanup cron deletes expired rows (see below).

### EventPollerService

Pattern mirrors `AutomationActionPoller`:

- `setInterval` 5s in `onModuleInit()`, cleared in `onModuleDestroy()`
- Poll: BEGIN; SELECT + JOIN tenants + FOR UPDATE OF plugin_events SKIP LOCKED; UPDATE status=queued; COMMIT; then `queue.add()` after commit
- `queue.add()` is outside the DB transaction — if Redis is unavailable, the row stays `queued`

Stuck-row recovery and expired-row cleanup are handled by crons in **WorkersModule** (following project architecture where all cron jobs live in WorkersModule):

- **Every 10 min**: `UPDATE plugin_events SET status='pending', queued_at=NULL WHERE status='queued' AND queued_at < NOW() - INTERVAL '15 minutes'` — uses `queued_at` (not `created_at`) to avoid premature recovery of rows that waited a long time in `pending` before being polled
- **Daily (2 AM)**: `DELETE FROM plugin_events WHERE expires_at < NOW()`

### AutomationEventProcessor

```typescript
@Processor(QUEUE_PLUGIN_EVENTS, { concurrency: 1 })
export class AutomationEventProcessor extends WorkerHost {
  constructor(
    @Inject('KNEX_INSTANCE') private readonly knex: Knex,  // for infra queries
    private readonly automationCore: AutomationCore,
    private readonly contextBuilder: ExecutionContextBuilder,
  ) { super(); }

  async process(job: Job<PluginEventJobData>): Promise<void> {
    const { eventId, eventName, tenantId, tenantTier, payload } = job.data;

    await TenantContext.run({ tenantId, tenantTier }, async () => {
      const ctx = await this.contextBuilder.buildForWorker(tenantId, tenantTier, eventId);
      await this.automationCore.fireTriggerEvents(ctx, eventName, payload);
    });

    // Raw Knex for infra table — same pattern as AutomationActionProcessor
    await this.knex('plugin_events')
      .where({ id: eventId })
      .update({ status: 'processed' });
  }

  async onFailed(job: Job<PluginEventJobData>, error: Error): Promise<void> {
    // Only reset to 'pending' after ALL BullMQ retries are exhausted.
    // While retries remain, BullMQ handles re-execution — resetting here would
    // cause double-processing. The stuck-row recovery cron handles the case
    // where the job was lost entirely (Redis failure after DB commit).
    const maxAttempts = job.opts?.attempts ?? 1;
    if (job.attemptsMade >= maxAttempts) {
      await this.knex('plugin_events')
        .where({ id: job.data.eventId })
        .update({ status: 'pending', queued_at: null });
    }
  }
}
```

`fireTriggerEvents(ctx, eventType, data)` signature **unchanged** — it receives a full `IExecutionContext` and uses `ctx.db` (QueryInterceptor-scoped) for all business queries.

### Changes to AutomationCore

`AutomationCore.onModuleInit()` removes the `after:customer.create` hook registration:

```typescript
// REMOVED — automation no longer uses hooks for trigger detection
this.hookRegistry.register('automation', { event: 'customer.create', type: 'after', priority: 20 }, ...);
```

`AUTOMATION_MANIFEST.hooks` set to `[]`.

### Changes to customer-data

`CustomerDataCore.onModuleInit()` registers the event definition:

```typescript
this.eventRegistry.register({
  name: 'customer.create',
  plugin: 'customer-data',
  description: 'Fired when a new customer is created',
  // Wrapped as { customer } to match the triggerContext shape expected by
  // evaluateConditions() — conditions reference fields as customer.name, customer.email, etc.
  schema: z.object({
    customer: z.object({
      id:      z.string().uuid(),
      name:    z.string(),
      email:   z.string().email().nullable(),
      company: z.string().nullable(),
    }),
  }),
});
```

`createCustomer()` adds `eventRegistry.emit()` as a **separate call alongside** the existing `hookRegistry.runAfter()`. The payload is wrapped as `{ customer }` — matching the shape that `fireTriggerEvents` and `evaluateConditions` expect:

```typescript
await this.hookRegistry.runAfter('customer.create', ctx, customer);        // KEPT
await this.eventRegistry.emit('customer.create', ctx, { customer });        // ADDED — wrapped
```

**Convention:** event payload shape mirrors the `triggerContext` argument passed to `fireTriggerEvents`. For `customer.create` that is `{ customer: Customer }`. Future events should follow the same convention: wrap the root entity under a named key matching the entity type.

### API: GET /api/v1/plugins/automation/events

New endpoint alongside `GET /actions`:

```typescript
@Get('events')
async getAvailableEvents(@CurrentTenant() tenant, @CurrentUser() user, @Req() req) {
  const ctx = await this.contextBuilder.build(tenant, user, req.correlationId);
  if (!ctx.enabledPlugins.includes('automation'))
    throw new ForbiddenException('automation plugin not enabled');

  // Filter at controller layer — EventRegistryService has no tenant context
  return {
    plugin: 'automation',
    data: this.eventRegistry.getDefinitions()
      .filter((def) => ctx.enabledPlugins.includes(def.plugin))
      .map((def) => ({
        name:        def.name,
        plugin:      def.plugin,
        description: def.description,
        fields:      schemaToFields(def),
      })),
  };
}
```

`schemaToFields()` is a private helper defined in `automation.controller.ts`:

```typescript
function schemaToFields(def: EventDefinition): { name: string; type: string }[] {
  const shape = (def.schema as z.ZodObject<z.ZodRawShape>).shape;
  // For wrapped schemas like { customer: z.object({...}) }, flatten one level
  const inner = shape['customer'] instanceof z.ZodObject ? shape['customer'].shape : shape;
  return Object.entries(inner).map(([name, field]) => ({
    name,
    type: field instanceof z.ZodString  ? 'string'
        : field instanceof z.ZodNumber  ? 'number'
        : field instanceof z.ZodBoolean ? 'boolean'
        : 'string',
  }));
}
```

This produces `[{ name: 'id', type: 'string' }, { name: 'name', type: 'string' }, ...]` for the UI condition builder.

### Frontend: CreateTriggerModal

- Replace hard-coded `event_type` select with query to `GET /automation/events`
- When an event is selected, its `fields` populate the condition builder's field dropdown
- `crmApi.getAvailableEvents(ctx)` added to `api-client.ts`

## What stays unchanged

- `HookRegistryService` and all existing hook registrations
- `customer-care`'s `after:customer.create` no-op hook (continues to fire via `runAfter` in `createCustomer`)
- `AutomationActionPoller`, `AutomationActionProcessor`, `automation_action_events` table
- `ActionRegistry` and all action handlers
- `fireTriggerEvents()` method signature

## Files changed

| | File | Change |
|---|---|---|
| NEW | `src/plugins/events/event-definition.interface.ts` | Interface |
| NEW | `src/plugins/events/event-registry.service.ts` | Service |
| NEW | `src/plugins/events/event-poller.service.ts` | Poller |
| NEW | `src/plugins/events/event-infra.module.ts` | `@Global()` module |
| NEW | `src/plugins/cores/automation/automation-event.processor.ts` | Processor |
| NEW | `src/db/migrations/YYYYMMDD_plugin_events.ts` | Migration |
| MOD | `src/workers/bullmq/queue.constants.ts` | Add `QUEUE_PLUGIN_EVENTS` (distinct from existing `QUEUE_PLUGIN_INIT`) |
| MOD | `src/workers/workers.module.ts` | Add stuck-row recovery cron + expired-row cleanup cron |
| MOD | `src/plugins/context/execution-context-builder.service.ts` | Add `buildForWorker()` |
| MOD | `src/plugins/plugin-infra.module.ts` | Import + re-export `EventInfraModule` |
| MOD | `src/plugins/cores/automation/automation.module.ts` | Add `AutomationEventProcessor` + `BullModule.registerQueue(QUEUE_PLUGIN_EVENTS)` |
| MOD | `src/plugins/cores/automation/automation.core.ts` | Remove hook registration in `onModuleInit()` |
| MOD | `src/plugins/manifest/built-in-manifests.ts` | `AUTOMATION_MANIFEST.hooks = []` |
| MOD | `src/plugins/cores/automation/automation.controller.ts` | Add `GET /events` endpoint |
| MOD | `src/plugins/cores/customer-data/customer-data.core.ts` | Register event def in `onModuleInit()`; add `emit()` call in `createCustomer()` alongside existing `runAfter` |
| MOD | `frontend/web/src/lib/api-client.ts` | Add `getAvailableEvents()` |
| MOD | `frontend/web/src/components/create-trigger-modal.tsx` | Dynamic event list + condition fields |
