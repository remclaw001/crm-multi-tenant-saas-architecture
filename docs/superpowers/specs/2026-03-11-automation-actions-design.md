# Automation Actions — Design Spec
**Date:** 2026-03-11
**Status:** Approved

## Problem

The automation plugin allows creating triggers (event_type + conditions) but the `actions` field is always stored as `[]`. There is no UI for selecting actions, no action catalog, and the execution hook is a no-op.

## Goal

- Define a typed, extensible action catalog (core + plugin-gated)
- Allow users to configure actions with static and template-string params
- Execute actions reliably via a DB-buffered event queue → BullMQ pipeline
- Avoid system overload via batched polling and controlled concurrency

---

## Architecture: Approach A — Command Pattern + BullMQ

```
customer.create request
  └─ CustomerDataCore.createCustomer()
       └─ HookRegistry.emit('after', 'customer.create')
            └─ AutomationCore.fireTriggerEvents()
                 └─ INSERT automation_action_events (status=pending)

[every 5s] AutomationActionPoller.poll()
  └─ SELECT pending FOR UPDATE SKIP LOCKED LIMIT 50
       └─ UPDATE status=queued
            └─ Queue.add('execute-action', jobData, { attempts:3, backoff:exponential })

[BullMQ worker] AutomationActionProcessor.process(job)
  └─ UPDATE status=processing
       └─ TenantContext.run(tenantId)
            └─ ActionRegistry.getHandler(actionType)
                 └─ resolveParams(params, triggerContext)
                      └─ handler.execute(ctx, resolvedParams)
                           └─ UPDATE status=completed
```

---

## Section 1 — Data Model

### New table: `automation_action_events`

```sql
CREATE TABLE automation_action_events (
  id                UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trigger_id        UUID NOT NULL REFERENCES automation_triggers(id) ON DELETE CASCADE,
  action_index      INTEGER NOT NULL,
  action_type       VARCHAR(100) NOT NULL,
  action_params     JSONB NOT NULL DEFAULT '{}',
  trigger_context   JSONB NOT NULL DEFAULT '{}',
  status            VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts          INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT,
  scheduled_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  queued_at         TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_action_events_pending   ON automation_action_events(scheduled_at) WHERE status = 'pending';
CREATE INDEX idx_action_events_tenant    ON automation_action_events(tenant_id);
CREATE INDEX idx_action_events_trigger   ON automation_action_events(trigger_id);
```

**No RLS** (background worker runs outside request context). Tenant isolation is enforced by:
1. Worker sets `TenantContext.run({ tenantId })` before each job — `QueryInterceptor` auto-scopes all queries
2. Worker validates `trigger.tenant_id === event.tenant_id` before executing

`action_index` allows one event row per action — actions are processed independently. `trigger_context` is a snapshot of the trigger payload at fire time; no re-query needed.

### `StoredAction` type (extensible discriminated union)

```typescript
interface BaseStoredAction<TType extends string, TParams extends Record<string, unknown>> {
  type: TType;
  params: TParams;
}

type WebhookCallAction    = BaseStoredAction<'webhook.call',          { url: string; method: string; body?: string }>;
type CustomerUpdateAction = BaseStoredAction<'customer.update_field', { field: string; value: string }>;
type CaseCreateAction     = BaseStoredAction<'case.create',           { title: string; priority: string; description?: string }>;

export type KnownStoredAction = WebhookCallAction | CustomerUpdateAction | CaseCreateAction;
export type StoredAction = KnownStoredAction | BaseStoredAction<string, Record<string, unknown>>;
```

---

## Section 2 — Action Catalog + Command Pattern

### `CommandHandler` interface

```typescript
export interface ActionCommandContext {
  tenantId: string;
  eventId: string;
  triggerId: string;
  triggerContext: Record<string, unknown>;
}

export interface CommandHandler<TParams = Record<string, unknown>> {
  readonly actionType: string;
  execute(ctx: ActionCommandContext, params: TParams): Promise<void>;
}
```

### Template Engine

File: `automation/template-engine.ts`

- Resolves `{{dot.path}}` against trigger context
- `resolveTemplate(template, context)` — string substitution
- `resolveParams(params, context)` — recursive over all string values in params object
- No eval, no loops, no conditionals — safe by design

### Action Catalog

File: `automation/action-catalog.ts`

```typescript
export interface ActionParamSchema {
  name: string;
  label: string;
  type: 'string' | 'url' | 'enum' | 'template-string';
  required: boolean;
  options?: { value: string; label: string }[];
  hint?: string;
}

export interface ActionDefinition {
  type: string;
  label: string;
  description: string;
  requiredPlugins: string[];
  params: ActionParamSchema[];
}
```

Three initial actions:

| type | requiredPlugins | params |
|------|----------------|--------|
| `webhook.call` | `[]` | url (url), method (enum: POST/GET/PUT), body (template-string) |
| `customer.update_field` | `['customer-data']` | field (enum), value (template-string) |
| `case.create` | `['customer-care']` | title (template-string), priority (enum: low/medium/high), description (template-string) |

### Action Registry

File: `automation/action-registry.ts`

```typescript
@Injectable()
export class ActionRegistry {
  private handlers = new Map<string, CommandHandler>();
  register(handler: CommandHandler): void
  getHandler(type: string): CommandHandler  // throws PluginError if unknown
  getAvailableFor(enabledPlugins: string[]): ActionDefinition[]
}
```

Handlers registered in `AutomationModule.onModuleInit()`.

### Handlers

Each handler injects `Knex` directly — no Core injection (avoids circular dependency). `QueryInterceptor` scopes queries automatically via `TenantContext`.

- `WebhookCallHandler` — native `fetch()`, resolves body template, sends HTTP request
- `CustomerUpdateFieldHandler` — validates customer belongs to tenant, UPDATE customers
- `CaseCreateHandler` — validates customer belongs to tenant, INSERT support_cases

---

## Section 3 — Trigger Evaluation + Event Creation

### `AutomationCore.fireTriggerEvents()`

```typescript
async fireTriggerEvents(
  ctx: IExecutionContext,
  eventType: string,
  triggerContext: Record<string, unknown>,
): Promise<void>
```

1. Query `automation_triggers` WHERE `event_type = eventType AND is_active = true`
   (QueryInterceptor scopes to tenant automatically)
2. For each trigger: evaluate conditions via `evaluateConditions(trigger.conditions, triggerContext)`
3. For each action in matching trigger's `actions[]`: create one `automation_action_events` row
4. Bulk INSERT all rows in one query

### Condition evaluator

Supports operators: `equals`, `not_equals`, `contains`, `starts_with`, `is_empty`, `is_not_empty`.
Empty/null `conditions` → always matches.

### Hook wiring

```typescript
// After customer.create — priority 20 (after customer-care at priority 10)
this.hookRegistry.on('after', 'customer.create', async ({ ctx, data }) => {
  await this.fireTriggerEvents(ctx, 'customer.create', { customer: data.customer });
}, { priority: 20 });
```

**Trigger context shape for `customer.create`:**
```typescript
{ customer: { id, name, email, phone, company, tenant_id, created_at } }
```

Template variables available: `{{customer.name}}`, `{{customer.email}}`, `{{customer.id}}`, etc.

---

## Section 4 — Polling + BullMQ Pipeline

### Queue constant

```typescript
// workers/bullmq/queue.constants.ts
export const QUEUE_AUTOMATION_ACTIONS = 'automation-actions';
```

### `AutomationActionPoller`

File: `workers/bullmq/automation-action.poller.ts`

- node-cron schedule: `*/5 * * * * *` (every 5 seconds)
- Batch size: 50 events per poll
- Uses `FOR UPDATE SKIP LOCKED` inside a transaction: atomic claim, safe for multiple instances
- Transaction: SELECT → UPDATE status=queued, queued_at=NOW() → commit → Queue.add() outside lock
- BullMQ job options: `attempts: 3`, `backoff: { type: 'exponential', delay: 2000 }`

### `AutomationActionProcessor`

File: `plugins/cores/automation/automation-action.processor.ts`

- `@Processor(QUEUE_AUTOMATION_ACTIONS)`, extends `WorkerHost`
- On process: UPDATE status=processing, attempts++
- Load tenant from DB (for tier info needed by TenantContext)
- `TenantContext.run({ tenantId, tier })` wraps handler execution
- On success: UPDATE status=completed, completed_at=NOW()
- `onFailed()`: UPDATE status=failed, last_error=error.message

Concurrency: `1` per instance (default). Increase after monitoring production load.

---

## Section 5 — API + Frontend

### New endpoint

`GET /api/v1/plugins/automation/actions`

Returns `ACTION_CATALOG` filtered by `ctx.enabledPlugins`. Standard automation plugin guard applies.

Response: `{ plugin: 'automation', data: ActionDefinition[] }`

### Frontend changes

**`create-trigger-modal.tsx`** — add Step 3: Actions

- `AddActionDropdown`: select from `ActionDefinition[]` fetched from `/actions`
- `ActionForm`: renders fields dynamically from `ActionDefinition.params`
  - `string` | `url` | `template-string` → `<input>` with hint as placeholder
  - `enum` → `<select>` with options from schema
- Multiple actions allowed; each has a remove button
- Actions displayed as ordered list

**`triggers-list.tsx`** — show action type badges per trigger

**`api-client.ts`** — add `getAvailableActions(): Promise<ActionDefinition[]>`

**`types/api.types.ts`** — update `AutomationTrigger.actions: StoredAction[]`

---

## Files Summary

### Backend — new
```
db/migrations/20260312000009_automation_action_events.ts
plugins/cores/automation/action-catalog.ts
plugins/cores/automation/template-engine.ts
plugins/cores/automation/action-registry.ts
plugins/cores/automation/handlers/command-handler.interface.ts
plugins/cores/automation/handlers/webhook-call.handler.ts
plugins/cores/automation/handlers/customer-update-field.handler.ts
plugins/cores/automation/handlers/case-create.handler.ts
plugins/cores/automation/automation-action.processor.ts
workers/bullmq/automation-action.poller.ts
```

### Backend — modified
```
plugins/cores/automation/automation.core.ts        fireTriggerEvents, evaluateConditions, hook wiring
plugins/cores/automation/automation.controller.ts  GET /actions endpoint
plugins/cores/automation/automation.module.ts      register handlers, processor, poller
workers/bullmq/queue.constants.ts                  QUEUE_AUTOMATION_ACTIONS
```

### Frontend — modified
```
app/(crm)/automation/page.tsx
components/create-trigger-modal.tsx                add ActionsStep (step 3)
components/triggers-list.tsx                       action badges
lib/api-client.ts
types/api.types.ts
```
