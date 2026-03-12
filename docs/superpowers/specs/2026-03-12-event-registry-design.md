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

Located at `src/plugins/events/`. Contains three things:

- `EventRegistryService` — in-memory registry of event definitions + `emit()` that INSERTs to `plugin_events` table
- `EventPollerService` — cron every 5s, polls `plugin_events` pending rows → enqueues to `QUEUE_PLUGIN_EVENTS`
- `BullModule.registerQueue(QUEUE_PLUGIN_EVENTS)` — queue registration

`PluginInfraModule` imports `EventInfraModule`, making `EventRegistryService` globally available via NestJS DI.

### Data flow

```
Plugin.emit('customer.create', ctx, data)
  → EventRegistryService.emit()
      → Zod validate data against registered schema
      → INSERT plugin_events (status=pending, expires_at=NOW()+7days)

EventPollerService (cron 5s)
  → SELECT pending WHERE expires_at > NOW() FOR UPDATE SKIP LOCKED LIMIT 50
  → UPDATE status=queued
  → queue.add(QUEUE_PLUGIN_EVENTS, { eventId, eventName, tenantId, payload })

AutomationEventProcessor (@Processor QUEUE_PLUGIN_EVENTS, in AutomationModule)
  → TenantContext.run({ tenantId, tenantTier })
  → automationCore.fireTriggerEvents(eventName, tenantId, payload)
      → query automation_triggers WHERE event_type=eventName AND is_active=true
      → evaluateConditions(trigger.conditions, payload)
      → INSERT automation_action_events (status=pending)

AutomationActionPoller → QUEUE_AUTOMATION_ACTIONS → AutomationActionProcessor
  (unchanged)
```

### EventDefinition interface

```typescript
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
  getDefinitions(): EventDefinition[]
  getDefinition(name: string): EventDefinition | undefined
}
```

- `register()` — called in each plugin core's `onModuleInit()`
- `emit()` — Zod-validates payload, INSERTs to `plugin_events`, throws on unknown event or schema mismatch
- `getDefinitions()` — used by `GET /api/v1/plugins/automation/events` endpoint, filtered by tenant's enabled plugins

### DB migration: `plugin_events`

```sql
CREATE TABLE plugin_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL,
  event_name  TEXT        NOT NULL,
  plugin      TEXT        NOT NULL,
  payload     JSONB       NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'pending',  -- pending | queued
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX ON plugin_events (status, created_at) WHERE status = 'pending';
```

No RLS — poller runs outside request context, tenant scoping via `tenant_id` column in payload.

TTL: 7 days default. EventPollerService skips rows where `expires_at < NOW()`. Cleanup cron (in WorkersModule) periodically deletes expired rows.

### EventPollerService

Pattern mirrors existing `AutomationActionPoller`:
- `setInterval` every 5s in `onModuleInit()`, cleared in `onModuleDestroy()`
- Transaction wraps SELECT + UPDATE + queue.add for atomicity
- `FOR UPDATE SKIP LOCKED` — safe for multiple server instances

### AutomationEventProcessor

- `@Processor(QUEUE_PLUGIN_EVENTS)` in `AutomationModule`
- Receives `{ eventId, eventName, tenantId, payload }`
- Resolves tenant tier, sets `TenantContext`, calls `automationCore.fireTriggerEvents()`
- `fireTriggerEvents()` signature updated to accept `(eventName, tenantId, payload)` directly (no full `IExecutionContext` required — uses `KNEX_INSTANCE` directly)

### Changes to HookRegistry usage

`AutomationCore.onModuleInit()` removes the `after:customer.create` hook registration — automation no longer uses hooks for trigger detection.

`customer-data.core.ts` adds `eventRegistry.emit('customer.create', ctx, customer)` after INSERT. Hook calls (`runBefore`, `runAfter`) remain for `customer-care` code intervention.

### API: GET /api/v1/plugins/automation/events

New endpoint alongside existing `GET /actions`:

```
Response:
{
  "plugin": "automation",
  "data": [
    {
      "name": "customer.create",
      "plugin": "customer-data",
      "description": "Fired when a new customer is created",
      "fields": [
        { "name": "id",      "type": "string" },
        { "name": "name",    "type": "string" },
        { "name": "email",   "type": "string" },
        { "name": "company", "type": "string" }
      ]
    }
  ]
}
```

Filtered to events from currently enabled plugins only.

### Frontend: CreateTriggerModal

- Replace hard-coded `event_type` select with dynamic query to `GET /automation/events`
- When an event is selected, its `fields` array populates the condition builder's field dropdown
- `crmApi.getAvailableEvents(ctx)` added to `api-client.ts`

## What stays unchanged

- `HookRegistryService` and all existing hook registrations
- `AutomationActionPoller` and `AutomationActionProcessor`
- `ActionRegistry` and all action handlers
- `automation_action_events` table and its poller/processor flow
- All other plugin cores (customer-care, analytics, marketing) — only customer-data adds an emit call initially

## Files changed

| | File | Change |
|---|---|---|
| NEW | `src/plugins/events/event-definition.interface.ts` | Interface |
| NEW | `src/plugins/events/event-registry.service.ts` | Service |
| NEW | `src/plugins/events/event-poller.service.ts` | Poller |
| NEW | `src/plugins/events/event-infra.module.ts` | Module |
| NEW | `src/plugins/cores/automation/automation-event.processor.ts` | Processor |
| NEW | `src/db/migrations/YYYYMMDD_plugin_events.ts` | Migration |
| MOD | `src/workers/bullmq/queue.constants.ts` | Add `QUEUE_PLUGIN_EVENTS` |
| MOD | `src/plugins/infra/plugin-infra.module.ts` | Import EventInfraModule |
| MOD | `src/plugins/cores/automation/automation.module.ts` | Add processor + queue |
| MOD | `src/plugins/cores/automation/automation.core.ts` | Remove hook registration, update `fireTriggerEvents` signature |
| MOD | `src/plugins/cores/automation/automation.controller.ts` | Add GET /events |
| MOD | `src/plugins/cores/customer-data/customer-data.core.ts` | Register event def + emit |
| MOD | `frontend/web/src/lib/api-client.ts` | Add `getAvailableEvents()` |
| MOD | `frontend/web/src/components/create-trigger-modal.tsx` | Dynamic event list + fields |
