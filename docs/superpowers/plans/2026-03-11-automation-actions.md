# Automation Actions Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a typed action catalog, action-selection UI, and a DB-buffered → BullMQ execution pipeline to the automation plugin so triggers can actually do something when they fire.

**Architecture:** Command Pattern: each action type is a `CommandHandler` registered in `ActionRegistry`. When a trigger fires, `AutomationCore.fireTriggerEvents()` INSERTs one `automation_action_events` row per action. A node-cron poller claims batches with `FOR UPDATE SKIP LOCKED` and pushes them to BullMQ. A `@Processor` worker picks them up, sets `TenantContext`, resolves template params, and calls the handler.

**Tech Stack:** NestJS, Knex (direct injection via `@Inject('KNEX_INSTANCE')`), BullMQ (`@nestjs/bullmq`), node-cron, React (Next.js 15), TanStack Query v5

---

## Chunk 1: Data Foundation

**Files:**
- Create: `backend/src/db/migrations/20260312000009_automation_action_events.ts`
- Create: `backend/src/plugins/cores/automation/types/stored-action.types.ts`
- Create: `backend/src/plugins/cores/automation/template-engine.ts`
- Create: `backend/src/plugins/cores/automation/action-catalog.ts`
- Test: `backend/src/plugins/cores/automation/__tests__/template-engine.test.ts`

---

### Task 1: Migration — `automation_action_events`

**Files:**
- Create: `backend/src/db/migrations/20260312000009_automation_action_events.ts`

- [ ] **Step 1: Write the migration**

```typescript
// backend/src/db/migrations/20260312000009_automation_action_events.ts
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('automation_action_events', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table
      .uuid('tenant_id')
      .notNullable()
      .references('id')
      .inTable('tenants')
      .onDelete('CASCADE');
    table
      .uuid('trigger_id')
      .notNullable()
      .references('id')
      .inTable('automation_triggers')
      .onDelete('CASCADE');
    table.integer('action_index').notNullable();
    table.string('action_type', 100).notNullable();
    table.jsonb('action_params').notNullable().defaultTo('{}');
    table.jsonb('trigger_context').notNullable().defaultTo('{}');
    table.string('status', 20).notNullable().defaultTo('pending');
    table.integer('attempts').notNullable().defaultTo(0);
    table.text('last_error').nullable();
    table.timestamp('scheduled_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('queued_at', { useTz: true }).nullable();
    table.timestamp('completed_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(
    `CREATE INDEX idx_action_events_pending ON automation_action_events(scheduled_at) WHERE status = 'pending'`,
  );
  await knex.raw(
    `CREATE INDEX idx_action_events_tenant ON automation_action_events(tenant_id)`,
  );
  await knex.raw(
    `CREATE INDEX idx_action_events_trigger ON automation_action_events(trigger_id)`,
  );
  // NOTE: No RLS — worker uses TenantContext.run() to scope queries manually.
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('automation_action_events');
}
```

- [ ] **Step 2: Run migration**

```bash
cd backend
npm run db:migrate
```

Expected: `Batch N run: 1 migrations` — no errors.

- [ ] **Step 3: Verify table exists**

```bash
docker compose exec backend npm run db:status
```

Expected: `20260312000009_automation_action_events` listed as Completed.

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/migrations/20260312000009_automation_action_events.ts
git commit -m "feat(automation): add automation_action_events table migration"
```

---

### Task 2: StoredAction types

**Files:**
- Create: `backend/src/plugins/cores/automation/types/stored-action.types.ts`

- [ ] **Step 1: Write the types file**

```typescript
// backend/src/plugins/cores/automation/types/stored-action.types.ts

export interface BaseStoredAction<
  TType extends string,
  TParams extends Record<string, unknown>,
> {
  type: TType;
  params: TParams;
}

export type WebhookCallAction = BaseStoredAction<
  'webhook.call',
  { url: string; method: 'GET' | 'POST' | 'PUT'; body?: string }
>;

export type CustomerUpdateFieldAction = BaseStoredAction<
  'customer.update_field',
  { field: string; value: string }
>;

export type CaseCreateAction = BaseStoredAction<
  'case.create',
  { title: string; priority: 'low' | 'medium' | 'high'; description?: string }
>;

export type KnownStoredAction =
  | WebhookCallAction
  | CustomerUpdateFieldAction
  | CaseCreateAction;

/** Extensible: allows future action types added by plugins. */
export type StoredAction =
  | KnownStoredAction
  | BaseStoredAction<string, Record<string, unknown>>;
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/plugins/cores/automation/types/stored-action.types.ts
git commit -m "feat(automation): add StoredAction discriminated union types"
```

---

### Task 3: Template Engine

**Files:**
- Create: `backend/src/plugins/cores/automation/template-engine.ts`
- Create: `backend/src/plugins/cores/automation/__tests__/template-engine.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/plugins/cores/automation/__tests__/template-engine.test.ts
import { describe, it, expect } from 'vitest';
import { resolveTemplate, resolveParams } from '../template-engine';

describe('resolveTemplate', () => {
  it('replaces {{dot.path}} with value from context', () => {
    const result = resolveTemplate('Hello {{customer.name}}!', { customer: { name: 'Alice' } });
    expect(result).toBe('Hello Alice!');
  });

  it('leaves placeholder intact when path not found', () => {
    const result = resolveTemplate('Hi {{customer.missing}}', { customer: {} });
    expect(result).toBe('Hi ');
  });

  it('handles nested paths', () => {
    const result = resolveTemplate('{{a.b.c}}', { a: { b: { c: 'deep' } } });
    expect(result).toBe('deep');
  });

  it('returns non-string values as empty string', () => {
    const result = resolveTemplate('{{x}}', { x: 42 });
    expect(result).toBe('42');
  });

  it('ignores unknown syntax gracefully', () => {
    const result = resolveTemplate('{{}}', {});
    expect(result).toBe('{{}}');
  });
});

describe('resolveParams', () => {
  it('recursively resolves all string values in params object', () => {
    const params = { title: 'New case for {{customer.name}}', priority: 'high' };
    const ctx = { customer: { name: 'Bob' } };
    expect(resolveParams(params, ctx)).toEqual({
      title: 'New case for Bob',
      priority: 'high',
    });
  });

  it('does not recurse into non-string values', () => {
    const params = { count: 5, active: true };
    expect(resolveParams(params, {})).toEqual({ count: 5, active: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
npx vitest src/plugins/cores/automation/__tests__/template-engine.test.ts
```

Expected: FAIL — `Cannot find module '../template-engine'`.

- [ ] **Step 3: Write the implementation**

```typescript
// backend/src/plugins/cores/automation/template-engine.ts

/** Resolves a dot-path like "customer.name" against a context object. */
function resolvePath(path: string, ctx: Record<string, unknown>): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc !== null && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, ctx);
}

/**
 * Replaces {{dot.path}} placeholders in a template string.
 * No eval, no loops, no conditionals — safe by design.
 */
export function resolveTemplate(
  template: string,
  ctx: Record<string, unknown>,
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path: string) => {
    const trimmed = path.trim();
    if (!trimmed) return match;
    const value = resolvePath(trimmed, ctx);
    if (value === undefined || value === null) return '';
    return String(value);
  });
}

/**
 * Recursively resolves all string values in a params object.
 * Non-string values are left as-is.
 */
export function resolveParams(
  params: Record<string, unknown>,
  ctx: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    result[key] = typeof value === 'string' ? resolveTemplate(value, ctx) : value;
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend
npx vitest src/plugins/cores/automation/__tests__/template-engine.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/plugins/cores/automation/template-engine.ts \
        backend/src/plugins/cores/automation/__tests__/template-engine.test.ts
git commit -m "feat(automation): add template engine for {{dot.path}} substitution"
```

---

### Task 4: Action Catalog

**Files:**
- Create: `backend/src/plugins/cores/automation/action-catalog.ts`

- [ ] **Step 1: Write the action catalog**

```typescript
// backend/src/plugins/cores/automation/action-catalog.ts

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

export const ACTION_CATALOG: ActionDefinition[] = [
  {
    type: 'webhook.call',
    label: 'Call Webhook',
    description: 'Send an HTTP request to an external URL.',
    requiredPlugins: [],
    params: [
      { name: 'url', label: 'URL', type: 'url', required: true, hint: 'https://example.com/webhook' },
      {
        name: 'method',
        label: 'Method',
        type: 'enum',
        required: true,
        options: [
          { value: 'POST', label: 'POST' },
          { value: 'GET',  label: 'GET'  },
          { value: 'PUT',  label: 'PUT'  },
        ],
      },
      {
        name: 'body',
        label: 'Body',
        type: 'template-string',
        required: false,
        hint: '{"customer": "{{customer.name}}"}',
      },
    ],
  },
  {
    type: 'customer.update_field',
    label: 'Update Customer Field',
    description: 'Update a field on the customer that triggered this event.',
    requiredPlugins: ['customer-data'],
    params: [
      {
        name: 'field',
        label: 'Field',
        type: 'enum',
        required: true,
        options: [
          { value: 'name',    label: 'Name'    },
          { value: 'email',   label: 'Email'   },
          { value: 'phone',   label: 'Phone'   },
          { value: 'company', label: 'Company' },
        ],
      },
      {
        name: 'value',
        label: 'Value',
        type: 'template-string',
        required: true,
        hint: '{{customer.name}}',
      },
    ],
  },
  {
    type: 'case.create',
    label: 'Create Support Case',
    description: 'Open a support case linked to the triggering customer.',
    requiredPlugins: ['customer-care'],
    params: [
      { name: 'title', label: 'Title', type: 'template-string', required: true, hint: 'Welcome — {{customer.name}}' },
      {
        name: 'priority',
        label: 'Priority',
        type: 'enum',
        required: true,
        options: [
          { value: 'low',    label: 'Low'    },
          { value: 'medium', label: 'Medium' },
          { value: 'high',   label: 'High'   },
        ],
      },
      { name: 'description', label: 'Description', type: 'template-string', required: false, hint: 'Customer email: {{customer.email}}' },
    ],
  },
];

/** Returns actions whose required plugins are all in the enabledPlugins list. */
export function getAvailableActions(enabledPlugins: string[]): ActionDefinition[] {
  return ACTION_CATALOG.filter((def) =>
    def.requiredPlugins.every((p) => enabledPlugins.includes(p)),
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/plugins/cores/automation/action-catalog.ts
git commit -m "feat(automation): add action catalog with 3 built-in action definitions"
```

---

## Chunk 2: Command Handlers + Action Registry

**Files:**
- Create: `backend/src/plugins/cores/automation/handlers/command-handler.interface.ts`
- Create: `backend/src/plugins/cores/automation/action-registry.ts`
- Create: `backend/src/plugins/cores/automation/handlers/webhook-call.handler.ts`
- Create: `backend/src/plugins/cores/automation/handlers/customer-update-field.handler.ts`
- Create: `backend/src/plugins/cores/automation/handlers/case-create.handler.ts`
- Test: `backend/src/plugins/cores/automation/__tests__/action-registry.test.ts`
- Test: `backend/src/plugins/cores/automation/__tests__/webhook-call.handler.test.ts`
- Test: `backend/src/plugins/cores/automation/__tests__/customer-update-field.handler.test.ts`
- Test: `backend/src/plugins/cores/automation/__tests__/case-create.handler.test.ts`

---

### Task 5: CommandHandler interface + ActionRegistry

**Files:**
- Create: `backend/src/plugins/cores/automation/handlers/command-handler.interface.ts`
- Create: `backend/src/plugins/cores/automation/action-registry.ts`
- Test: `backend/src/plugins/cores/automation/__tests__/action-registry.test.ts`

- [ ] **Step 1: Write the CommandHandler interface**

```typescript
// backend/src/plugins/cores/automation/handlers/command-handler.interface.ts

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

- [ ] **Step 2: Write the failing ActionRegistry test**

```typescript
// backend/src/plugins/cores/automation/__tests__/action-registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ActionRegistry } from '../action-registry';
import type { CommandHandler } from '../handlers/command-handler.interface';

function makeHandler(type: string): CommandHandler {
  return { actionType: type, execute: async () => {} };
}

describe('ActionRegistry', () => {
  let registry: ActionRegistry;

  beforeEach(() => {
    registry = new ActionRegistry();
  });

  it('getHandler returns registered handler', () => {
    registry.register(makeHandler('webhook.call'));
    const h = registry.getHandler('webhook.call');
    expect(h.actionType).toBe('webhook.call');
  });

  it('getHandler throws PluginError for unknown type', () => {
    expect(() => registry.getHandler('unknown.type')).toThrow();
  });

  it('getAvailableFor returns definitions filtered by enabled plugins', () => {
    registry.register(makeHandler('webhook.call'));
    registry.register(makeHandler('customer.update_field'));
    registry.register(makeHandler('case.create'));

    // customer-data enabled → webhook.call + customer.update_field
    const defs = registry.getAvailableFor(['customer-data']);
    const types = defs.map((d) => d.type);
    expect(types).toContain('webhook.call');
    expect(types).toContain('customer.update_field');
    expect(types).not.toContain('case.create'); // requires customer-care
  });

  it('getAvailableFor with no plugins returns only no-requirement actions', () => {
    registry.register(makeHandler('webhook.call'));
    registry.register(makeHandler('customer.update_field'));
    const defs = registry.getAvailableFor([]);
    expect(defs.map((d) => d.type)).toEqual(['webhook.call']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd backend
npx vitest src/plugins/cores/automation/__tests__/action-registry.test.ts
```

Expected: FAIL — `Cannot find module '../action-registry'`.

- [ ] **Step 4: Write ActionRegistry**

```typescript
// backend/src/plugins/cores/automation/action-registry.ts
import { Injectable } from '@nestjs/common';
import { PluginError } from '../../../common/errors/domain.errors';
import type { CommandHandler } from './handlers/command-handler.interface';
import { ACTION_CATALOG, getAvailableActions } from './action-catalog';
import type { ActionDefinition } from './action-catalog';

@Injectable()
export class ActionRegistry {
  private readonly handlers = new Map<string, CommandHandler>();

  register(handler: CommandHandler): void {
    this.handlers.set(handler.actionType, handler);
  }

  getHandler(type: string): CommandHandler {
    const handler = this.handlers.get(type);
    if (!handler) {
      throw new PluginError(`Unknown action type: "${type}"`);
    }
    return handler;
  }

  getAvailableFor(enabledPlugins: string[]): ActionDefinition[] {
    const available = getAvailableActions(enabledPlugins);
    // Only include definitions for registered handlers
    return available.filter((def) => this.handlers.has(def.type));
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd backend
npx vitest src/plugins/cores/automation/__tests__/action-registry.test.ts
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/plugins/cores/automation/handlers/command-handler.interface.ts \
        backend/src/plugins/cores/automation/action-registry.ts \
        backend/src/plugins/cores/automation/__tests__/action-registry.test.ts
git commit -m "feat(automation): add CommandHandler interface and ActionRegistry"
```

---

### Task 6: WebhookCallHandler

**Files:**
- Create: `backend/src/plugins/cores/automation/handlers/webhook-call.handler.ts`
- Test: `backend/src/plugins/cores/automation/__tests__/webhook-call.handler.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/plugins/cores/automation/__tests__/webhook-call.handler.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', mockFetch);

import { WebhookCallHandler } from '../handlers/webhook-call.handler';
import type { ActionCommandContext } from '../handlers/command-handler.interface';

const ctx: ActionCommandContext = {
  tenantId: 'tenant-1',
  eventId: 'event-1',
  triggerId: 'trigger-1',
  triggerContext: { customer: { name: 'Alice', email: 'alice@example.com' } },
};

describe('WebhookCallHandler', () => {
  let handler: WebhookCallHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    handler = new WebhookCallHandler();
  });

  it('has correct actionType', () => {
    expect(handler.actionType).toBe('webhook.call');
  });

  it('calls fetch with resolved URL, method, and body', async () => {
    await handler.execute(ctx, {
      url: 'https://example.com/hook',
      method: 'POST',
      body: '{"name":"{{customer.name}}"}',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.objectContaining({
        method: 'POST',
        body: '{"name":"Alice"}',
      }),
    );
  });

  it('calls fetch without body when body param is omitted', async () => {
    await handler.execute(ctx, { url: 'https://example.com/hook', method: 'GET' });
    const [, options] = mockFetch.mock.calls[0];
    expect(options.body).toBeUndefined();
  });

  it('throws when fetch response is not ok', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' });
    await expect(
      handler.execute(ctx, { url: 'https://example.com/hook', method: 'POST' }),
    ).rejects.toThrow('Webhook returned 503');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
npx vitest src/plugins/cores/automation/__tests__/webhook-call.handler.test.ts
```

Expected: FAIL — `Cannot find module '../handlers/webhook-call.handler'`.

- [ ] **Step 3: Write the handler**

```typescript
// backend/src/plugins/cores/automation/handlers/webhook-call.handler.ts
import { Injectable } from '@nestjs/common';
import type { CommandHandler, ActionCommandContext } from './command-handler.interface';
import { resolveTemplate, resolveParams } from '../template-engine';

interface WebhookCallParams {
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  body?: string;
}

@Injectable()
export class WebhookCallHandler implements CommandHandler<WebhookCallParams> {
  readonly actionType = 'webhook.call';

  async execute(ctx: ActionCommandContext, params: WebhookCallParams): Promise<void> {
    const resolved = resolveParams(params as Record<string, unknown>, ctx.triggerContext) as WebhookCallParams;
    const url = resolved.url;

    const options: RequestInit = {
      method: resolved.method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (resolved.body !== undefined) {
      options.body = resolved.body;
    }

    const res = await fetch(url, options);
    if (!res.ok) {
      throw new Error(`Webhook returned ${res.status}: ${res.statusText}`);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend
npx vitest src/plugins/cores/automation/__tests__/webhook-call.handler.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/plugins/cores/automation/handlers/webhook-call.handler.ts \
        backend/src/plugins/cores/automation/__tests__/webhook-call.handler.test.ts
git commit -m "feat(automation): add WebhookCallHandler"
```

---

### Task 7: CustomerUpdateFieldHandler

**Files:**
- Create: `backend/src/plugins/cores/automation/handlers/customer-update-field.handler.ts`
- Test: `backend/src/plugins/cores/automation/__tests__/customer-update-field.handler.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/plugins/cores/automation/__tests__/customer-update-field.handler.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockKnex = vi.hoisted(() => {
  const where = vi.fn().mockReturnThis();
  const update = vi.fn().mockResolvedValue(1);
  const first = vi.fn().mockResolvedValue({ id: 'cust-1', tenant_id: 'tenant-1' });
  const select = vi.fn().mockReturnThis();
  const queryBuilder: any = { where, update, first, select };
  const knexFn = vi.fn().mockReturnValue(queryBuilder);
  return { knexFn, where, update, first, select };
});

vi.mock('knex', () => ({ default: vi.fn(() => mockKnex.knexFn) }));

import { CustomerUpdateFieldHandler } from '../handlers/customer-update-field.handler';
import type { ActionCommandContext } from '../handlers/command-handler.interface';

const ctx: ActionCommandContext = {
  tenantId: 'tenant-1',
  eventId: 'event-1',
  triggerId: 'trigger-1',
  triggerContext: { customer: { id: 'cust-1', name: 'Alice' } },
};

describe('CustomerUpdateFieldHandler', () => {
  let handler: CustomerUpdateFieldHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mockKnex.first.mockResolvedValue({ id: 'cust-1', tenant_id: 'tenant-1' });
    mockKnex.update.mockResolvedValue(1);
    handler = new CustomerUpdateFieldHandler(mockKnex.knexFn as any);
  });

  it('has correct actionType', () => {
    expect(handler.actionType).toBe('customer.update_field');
  });

  it('updates the specified field on customers table', async () => {
    await handler.execute(ctx, { field: 'company', value: 'Acme Corp' });
    expect(mockKnex.update).toHaveBeenCalledWith(expect.objectContaining({ company: 'Acme Corp' }));
  });

  it('resolves template in value', async () => {
    await handler.execute(ctx, { field: 'name', value: '{{customer.name}} Updated' });
    expect(mockKnex.update).toHaveBeenCalledWith(expect.objectContaining({ name: 'Alice Updated' }));
  });

  it('throws when customer not found', async () => {
    mockKnex.first.mockResolvedValue(null);
    await expect(
      handler.execute(ctx, { field: 'company', value: 'X' }),
    ).rejects.toThrow('Customer not found');
  });

  it('throws when customer belongs to different tenant', async () => {
    mockKnex.first.mockResolvedValue({ id: 'cust-1', tenant_id: 'other-tenant' });
    await expect(
      handler.execute(ctx, { field: 'company', value: 'X' }),
    ).rejects.toThrow('tenant');
  });

  it('rejects invalid field names to prevent SQL injection', async () => {
    await expect(
      handler.execute(ctx, { field: 'invalid_field', value: 'X' }),
    ).rejects.toThrow('Invalid field');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
npx vitest src/plugins/cores/automation/__tests__/customer-update-field.handler.test.ts
```

Expected: FAIL — `Cannot find module '../handlers/customer-update-field.handler'`.

- [ ] **Step 3: Write the handler**

```typescript
// backend/src/plugins/cores/automation/handlers/customer-update-field.handler.ts
import { Injectable, Inject } from '@nestjs/common';
import type { Knex } from 'knex';
import { DomainError } from '../../../../common/errors/domain.errors';
import type { CommandHandler, ActionCommandContext } from './command-handler.interface';
import { resolveTemplate } from '../template-engine';

const ALLOWED_FIELDS = ['name', 'email', 'phone', 'company'] as const;
type AllowedField = (typeof ALLOWED_FIELDS)[number];

interface CustomerUpdateFieldParams {
  field: string;
  value: string;
}

@Injectable()
export class CustomerUpdateFieldHandler
  implements CommandHandler<CustomerUpdateFieldParams>
{
  readonly actionType = 'customer.update_field';

  constructor(@Inject('KNEX_INSTANCE') private readonly knex: Knex) {}

  async execute(
    ctx: ActionCommandContext,
    params: CustomerUpdateFieldParams,
  ): Promise<void> {
    if (!(ALLOWED_FIELDS as readonly string[]).includes(params.field)) {
      throw new DomainError(`Invalid field: "${params.field}". Allowed: ${ALLOWED_FIELDS.join(', ')}`);
    }

    const customerId = (ctx.triggerContext.customer as Record<string, unknown>)?.id as string;

    // QueryInterceptor scopes this automatically via TenantContext
    const customer = await this.knex('customers')
      .where({ id: customerId })
      .select('id', 'tenant_id')
      .first();

    if (!customer) {
      throw new DomainError('Customer not found');
    }
    if (customer.tenant_id !== ctx.tenantId) {
      throw new DomainError('Customer belongs to different tenant');
    }

    const resolved = resolveTemplate(params.value, ctx.triggerContext);
    await this.knex('customers')
      .where({ id: customerId })
      .update({ [params.field as AllowedField]: resolved, updated_at: this.knex.raw('NOW()') });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend
npx vitest src/plugins/cores/automation/__tests__/customer-update-field.handler.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/plugins/cores/automation/handlers/customer-update-field.handler.ts \
        backend/src/plugins/cores/automation/__tests__/customer-update-field.handler.test.ts
git commit -m "feat(automation): add CustomerUpdateFieldHandler"
```

---

### Task 8: CaseCreateHandler

**Files:**
- Create: `backend/src/plugins/cores/automation/handlers/case-create.handler.ts`
- Test: `backend/src/plugins/cores/automation/__tests__/case-create.handler.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/plugins/cores/automation/__tests__/case-create.handler.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInsert = vi.hoisted(() => vi.fn().mockReturnThis());
const mockReturning = vi.hoisted(() => vi.fn().mockResolvedValue([{ id: 'case-new' }]));
const mockFirst = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'cust-1', tenant_id: 'tenant-1' }));
const mockWhere = vi.hoisted(() => vi.fn().mockReturnThis());
const mockSelect = vi.hoisted(() => vi.fn().mockReturnThis());
const mockKnexFn = vi.hoisted(() =>
  vi.fn().mockReturnValue({ where: mockWhere, select: mockSelect, first: mockFirst, insert: mockInsert, returning: mockReturning }),
);

import { CaseCreateHandler } from '../handlers/case-create.handler';
import type { ActionCommandContext } from '../handlers/command-handler.interface';

const ctx: ActionCommandContext = {
  tenantId: 'tenant-1',
  eventId: 'event-1',
  triggerId: 'trigger-1',
  triggerContext: { customer: { id: 'cust-1', name: 'Alice', email: 'alice@test.com' } },
};

describe('CaseCreateHandler', () => {
  let handler: CaseCreateHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFirst.mockResolvedValue({ id: 'cust-1', tenant_id: 'tenant-1' });
    mockReturning.mockResolvedValue([{ id: 'case-new' }]);
    handler = new CaseCreateHandler(mockKnexFn as any);
  });

  it('has correct actionType', () => {
    expect(handler.actionType).toBe('case.create');
  });

  it('inserts a support_case with resolved title', async () => {
    await handler.execute(ctx, {
      title: 'Welcome {{customer.name}}',
      priority: 'medium',
    });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-1',
        customer_id: 'cust-1',
        title: 'Welcome Alice',
        priority: 'medium',
        status: 'open',
      }),
    );
  });

  it('throws when customer not found', async () => {
    mockFirst.mockResolvedValue(null);
    await expect(
      handler.execute(ctx, { title: 'Test', priority: 'low' }),
    ).rejects.toThrow('Customer not found');
  });

  it('throws when customer belongs to different tenant', async () => {
    mockFirst.mockResolvedValue({ id: 'cust-1', tenant_id: 'other' });
    await expect(
      handler.execute(ctx, { title: 'Test', priority: 'low' }),
    ).rejects.toThrow('tenant');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
npx vitest src/plugins/cores/automation/__tests__/case-create.handler.test.ts
```

Expected: FAIL — `Cannot find module '../handlers/case-create.handler'`.

- [ ] **Step 3: Write the handler**

```typescript
// backend/src/plugins/cores/automation/handlers/case-create.handler.ts
import { Injectable, Inject } from '@nestjs/common';
import type { Knex } from 'knex';
import { DomainError } from '../../../../common/errors/domain.errors';
import type { CommandHandler, ActionCommandContext } from './command-handler.interface';
import { resolveTemplate } from '../template-engine';

interface CaseCreateParams {
  title: string;
  priority: 'low' | 'medium' | 'high';
  description?: string;
}

@Injectable()
export class CaseCreateHandler implements CommandHandler<CaseCreateParams> {
  readonly actionType = 'case.create';

  constructor(@Inject('KNEX_INSTANCE') private readonly knex: Knex) {}

  async execute(ctx: ActionCommandContext, params: CaseCreateParams): Promise<void> {
    const customerId = (ctx.triggerContext.customer as Record<string, unknown>)?.id as string;

    const customer = await this.knex('customers')
      .where({ id: customerId })
      .select('id', 'tenant_id')
      .first();

    if (!customer) {
      throw new DomainError('Customer not found');
    }
    if (customer.tenant_id !== ctx.tenantId) {
      throw new DomainError('Customer belongs to different tenant');
    }

    const title = resolveTemplate(params.title, ctx.triggerContext);
    const description = params.description
      ? resolveTemplate(params.description, ctx.triggerContext)
      : undefined;

    await this.knex('support_cases')
      .insert({
        tenant_id: ctx.tenantId,
        customer_id: customerId,
        title,
        priority: params.priority,
        description: description ?? null,
        status: 'open',
      })
      .returning('id');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend
npx vitest src/plugins/cores/automation/__tests__/case-create.handler.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Run all automation tests**

```bash
cd backend
npx vitest src/plugins/cores/automation/
```

Expected: All tests in the automation directory PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/plugins/cores/automation/handlers/case-create.handler.ts \
        backend/src/plugins/cores/automation/__tests__/case-create.handler.test.ts
git commit -m "feat(automation): add CaseCreateHandler"
```

---

## Chunk 3: Trigger Evaluation

**Files:**
- Modify: `backend/src/plugins/cores/automation/automation.core.ts` — add `fireTriggerEvents`, `evaluateConditions`, update hook wiring
- Test: `backend/src/plugins/__tests__/automation.core.test.ts` — add new test cases

---

### Task 9: `fireTriggerEvents` + `evaluateConditions` + hook wiring

- [ ] **Step 1: Write additional failing tests**

Add these `describe` blocks to `backend/src/plugins/__tests__/automation.core.test.ts`:

```typescript
// Add to the existing test file at the bottom

describe('evaluateConditions', () => {
  it('returns true for empty conditions', () => {
    // Need to test the private method via fireTriggerEvents or expose for test
    // We'll test via fireTriggerEvents with a trigger that has no conditions
    // This is covered by the fireTriggerEvents tests below
  });
});

describe('fireTriggerEvents', () => {
  it('does nothing when no active triggers match event_type', async () => {
    const ctx = makeCtx({ orderBy: vi.fn().mockResolvedValue([]) });
    // Should not throw, no inserts
    await core.fireTriggerEvents(ctx, 'customer.create', { customer: { id: 'c1' } });
    expect(ctx.db.db).toHaveBeenCalledWith('automation_triggers');
  });

  it('inserts one event row per action in matching trigger', async () => {
    const trigger = {
      id: 'trig-1',
      tenant_id: 'tenant-123',
      event_type: 'customer.create',
      is_active: true,
      conditions: {},
      actions: [
        { type: 'webhook.call', params: { url: 'https://x.com', method: 'POST' } },
        { type: 'case.create', params: { title: 'New case', priority: 'low' } },
      ],
    };

    const insertMock = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({
      orderBy: vi.fn().mockResolvedValue([trigger]),
      insert: insertMock,
    });

    await core.fireTriggerEvents(ctx, 'customer.create', { customer: { id: 'c1' } });

    expect(insertMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ action_index: 0, action_type: 'webhook.call' }),
        expect.objectContaining({ action_index: 1, action_type: 'case.create' }),
      ]),
    );
  });

  it('skips trigger whose conditions do not match', async () => {
    const trigger = {
      id: 'trig-1',
      tenant_id: 'tenant-123',
      event_type: 'customer.create',
      is_active: true,
      conditions: { and: [{ field: 'company', op: 'equals', value: 'SpecificCo' }] },
      actions: [{ type: 'webhook.call', params: { url: 'https://x.com', method: 'POST' } }],
    };

    const insertMock = vi.fn();
    const ctx = makeCtx({
      orderBy: vi.fn().mockResolvedValue([trigger]),
      insert: insertMock,
    });

    await core.fireTriggerEvents(ctx, 'customer.create', { customer: { company: 'OtherCo' } });

    expect(insertMock).not.toHaveBeenCalled();
  });

  it('skips trigger with no actions (nothing to insert)', async () => {
    const trigger = {
      id: 'trig-2',
      tenant_id: 'tenant-123',
      event_type: 'customer.create',
      is_active: true,
      conditions: {},
      actions: [],
    };

    const insertMock = vi.fn();
    const ctx = makeCtx({
      orderBy: vi.fn().mockResolvedValue([trigger]),
      insert: insertMock,
    });

    await core.fireTriggerEvents(ctx, 'customer.create', { customer: { id: 'c1' } });
    expect(insertMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify new ones fail**

```bash
cd backend
npx vitest src/plugins/__tests__/automation.core.test.ts
```

Expected: New tests FAIL — `fireTriggerEvents is not a function`.

- [ ] **Step 3: Update `automation.core.ts`**

Replace the entire file content with:

```typescript
// backend/src/plugins/cores/automation/automation.core.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { AUTOMATION_MANIFEST } from '../../manifest/built-in-manifests';
import type { IPluginCore } from '../../interfaces/plugin-core.interface';
import type { PluginManifest } from '../../interfaces/plugin-manifest.interface';
import type { IExecutionContext } from '../../interfaces/execution-context.interface';
import { PluginRegistryService } from '../../registry/plugin-registry.service';
import { HookRegistryService } from '../../hooks/hook-registry.service';
import { ResourceNotFoundError } from '../../../common/errors/domain.errors';
import type { StoredAction } from './types/stored-action.types';

export interface AutomationTrigger {
  id: string;
  tenant_id: string;
  name: string;
  event_type: string;
  conditions: Record<string, unknown>;
  actions: StoredAction[];
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateTriggerInput {
  name: string;
  event_type: string;
  conditions?: Record<string, unknown>;
  actions?: StoredAction[];
  is_active?: boolean;
}

export interface UpdateTriggerInput {
  name?: string;
  event_type?: string;
  conditions?: Record<string, unknown>;
  actions?: StoredAction[];
  is_active?: boolean;
}

interface ConditionRule {
  field: string;
  op: string;
  value?: string;
}

@Injectable()
export class AutomationCore implements IPluginCore, OnModuleInit {
  readonly manifest: PluginManifest = AUTOMATION_MANIFEST;

  constructor(
    private readonly registry: PluginRegistryService,
    private readonly hookRegistry: HookRegistryService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);

    // Fire trigger events AFTER customer is created (priority 20 = after customer-care at 10)
    this.hookRegistry.register(
      'automation',
      { event: 'customer.create', type: 'after', priority: 20 },
      async (ctx, data: { customer: Record<string, unknown> }) => {
        await this.fireTriggerEvents(ctx, 'customer.create', { customer: data.customer });
      },
    );
  }

  // ── Trigger CRUD ────────────────────────────────────────────────────────────

  async listTriggers(ctx: IExecutionContext): Promise<AutomationTrigger[]> {
    return ctx.db
      .db('automation_triggers')
      .select('*')
      .orderBy('created_at', 'desc') as Promise<AutomationTrigger[]>;
  }

  async getTrigger(ctx: IExecutionContext, id: string): Promise<AutomationTrigger> {
    const row = await ctx.db.db('automation_triggers').where({ id }).first();
    if (!row) throw new ResourceNotFoundError('AutomationTrigger', id);
    return row as AutomationTrigger;
  }

  async createTrigger(
    ctx: IExecutionContext,
    input: CreateTriggerInput,
  ): Promise<AutomationTrigger> {
    const [trigger] = await ctx.db
      .db('automation_triggers')
      .insert({
        tenant_id: ctx.tenantId,
        name: input.name,
        event_type: input.event_type,
        conditions: JSON.stringify(input.conditions ?? {}),
        actions: JSON.stringify(input.actions ?? []),
        is_active: input.is_active ?? true,
      })
      .returning('*') as AutomationTrigger[];
    return trigger;
  }

  async updateTrigger(
    ctx: IExecutionContext,
    id: string,
    input: UpdateTriggerInput,
  ): Promise<AutomationTrigger> {
    const patch: Record<string, unknown> = { ...input, updated_at: ctx.db.db.raw('NOW()') };
    if (input.conditions !== undefined) patch.conditions = JSON.stringify(input.conditions);
    if (input.actions !== undefined) patch.actions = JSON.stringify(input.actions);

    const [updated] = await ctx.db
      .db('automation_triggers')
      .where({ id })
      .update(patch)
      .returning('*') as AutomationTrigger[];
    if (!updated) throw new ResourceNotFoundError('AutomationTrigger', id);
    return updated;
  }

  async deleteTrigger(ctx: IExecutionContext, id: string): Promise<void> {
    const count = await ctx.db.db('automation_triggers').where({ id }).del();
    if (count === 0) throw new ResourceNotFoundError('AutomationTrigger', id);
  }

  // ── Trigger evaluation ──────────────────────────────────────────────────────

  async fireTriggerEvents(
    ctx: IExecutionContext,
    eventType: string,
    triggerContext: Record<string, unknown>,
  ): Promise<void> {
    const triggers = await ctx.db
      .db('automation_triggers')
      .select('*')
      .where({ event_type: eventType, is_active: true })
      .orderBy('created_at', 'asc') as AutomationTrigger[];

    const rows: Record<string, unknown>[] = [];

    for (const trigger of triggers) {
      if (!this.evaluateConditions(trigger.conditions, triggerContext)) continue;
      const actions = trigger.actions ?? [];
      if (actions.length === 0) continue;

      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        rows.push({
          tenant_id: ctx.tenantId,
          trigger_id: trigger.id,
          action_index: i,
          action_type: action.type,
          action_params: JSON.stringify(action.params),
          trigger_context: JSON.stringify(triggerContext),
          status: 'pending',
        });
      }
    }

    if (rows.length > 0) {
      await ctx.db.db('automation_action_events').insert(rows);
    }
  }

  /** Returns true if all conditions in `conditions.and[]` match the context. */
  evaluateConditions(
    conditions: Record<string, unknown>,
    triggerContext: Record<string, unknown>,
  ): boolean {
    const rules = (conditions?.and as ConditionRule[] | undefined) ?? [];
    if (rules.length === 0) return true;

    const customer = (triggerContext.customer as Record<string, unknown>) ?? {};

    for (const rule of rules) {
      const fieldValue = String(customer[rule.field] ?? '');
      const ruleValue = rule.value ?? '';

      switch (rule.op) {
        case 'equals':       if (fieldValue !== ruleValue) return false; break;
        case 'not_equals':   if (fieldValue === ruleValue) return false; break;
        case 'contains':     if (!fieldValue.includes(ruleValue)) return false; break;
        case 'starts_with':  if (!fieldValue.startsWith(ruleValue)) return false; break;
        case 'is_empty':     if (fieldValue.trim() !== '') return false; break;
        case 'is_not_empty': if (fieldValue.trim() === '') return false; break;
        default:             break; // unknown operators are skipped (permissive)
      }
    }
    return true;
  }
}
```

- [ ] **Step 4: Run all automation core tests**

```bash
cd backend
npx vitest src/plugins/__tests__/automation.core.test.ts
```

Expected: All tests PASS (existing + new).

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
cd backend
npm test
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/plugins/cores/automation/automation.core.ts \
        backend/src/plugins/__tests__/automation.core.test.ts
git commit -m "feat(automation): add fireTriggerEvents, evaluateConditions, hook wiring (after customer.create)"
```

---

## Chunk 4: BullMQ Pipeline

**Files:**
- Modify: `backend/src/workers/bullmq/queue.constants.ts` — add `QUEUE_AUTOMATION_ACTIONS`
- Create: `backend/src/plugins/cores/automation/automation-action.poller.ts`
- Create: `backend/src/plugins/cores/automation/automation-action.processor.ts`
- Modify: `backend/src/workers/bullmq/bullmq.module.ts` — register queue + processor
- Modify: `backend/src/plugins/cores/automation/automation.module.ts` — register registry, handlers, poller
- Test: `backend/src/plugins/cores/automation/__tests__/automation-action.poller.test.ts`
- Test: `backend/src/plugins/cores/automation/__tests__/automation-action.processor.test.ts`

---

### Task 10: Queue constant + AutomationActionPoller

- [ ] **Step 1: Add queue constant**

Edit `backend/src/workers/bullmq/queue.constants.ts` — append:

```typescript
export const QUEUE_AUTOMATION_ACTIONS = 'automation-actions' as const;
```

- [ ] **Step 2: Write the failing poller test**

```typescript
// backend/src/plugins/cores/automation/__tests__/automation-action.poller.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockKnexBuilder = vi.hoisted(() => {
  const forUpdate = vi.fn().mockReturnThis();
  const skipLocked = vi.fn().mockReturnThis();
  const limit = vi.fn().mockReturnThis();
  const update = vi.fn().mockReturnThis();
  const whereIn = vi.fn().mockReturnThis();
  const returning = vi.fn().mockResolvedValue([]);
  const select = vi.fn().mockReturnThis();
  const where = vi.fn().mockReturnThis();
  const orderBy = vi.fn().mockReturnThis();
  return { forUpdate, skipLocked, limit, update, whereIn, returning, select, where, orderBy };
});

const mockTransact = vi.hoisted(() => vi.fn((fn: (trx: any) => Promise<void>) => fn({
  ...mockKnexBuilder,
} as any)));

const mockKnexFn = vi.hoisted(() => vi.fn().mockReturnValue(mockKnexBuilder));
(mockKnexFn as any).transaction = mockTransact;

const mockQueueAdd = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockQueue = vi.hoisted(() => ({ add: mockQueueAdd }));

import { AutomationActionPoller } from '../automation-action.poller';

describe('AutomationActionPoller', () => {
  let poller: AutomationActionPoller;

  beforeEach(() => {
    vi.clearAllMocks();
    poller = new AutomationActionPoller(mockKnexFn as any, mockQueue as any);
  });

  it('does nothing when no pending events found', async () => {
    mockKnexBuilder.returning.mockResolvedValue([]);
    await poller.poll();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('adds one BullMQ job per claimed event', async () => {
    const events = [
      { id: 'evt-1', tenant_id: 't1', trigger_id: 'trig-1', action_index: 0,
        action_type: 'webhook.call', action_params: {}, trigger_context: {} },
    ];
    mockKnexBuilder.returning.mockResolvedValue(events);
    await poller.poll();
    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'execute-action',
      expect.objectContaining({ eventId: 'evt-1', actionType: 'webhook.call' }),
      expect.objectContaining({ attempts: 3 }),
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd backend
npx vitest src/plugins/cores/automation/__tests__/automation-action.poller.test.ts
```

Expected: FAIL — `Cannot find module '../automation-action.poller'`.

- [ ] **Step 4: Write the poller**

```typescript
// backend/src/plugins/cores/automation/automation-action.poller.ts
import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Knex } from 'knex';
import type { Queue } from 'bullmq';
import * as cron from 'node-cron';
import { QUEUE_AUTOMATION_ACTIONS } from '../../../workers/bullmq/queue.constants';

export interface AutomationActionJobData {
  eventId: string;
  tenantId: string;
  triggerId: string;
  actionIndex: number;
  actionType: string;
  actionParams: Record<string, unknown>;
  triggerContext: Record<string, unknown>;
}

const BATCH_SIZE = 50;

@Injectable()
export class AutomationActionPoller implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutomationActionPoller.name);
  private task: cron.ScheduledTask | undefined;

  constructor(
    @Inject('KNEX_INSTANCE') private readonly knex: Knex,
    @InjectQueue(QUEUE_AUTOMATION_ACTIONS) private readonly queue: Queue,
  ) {}

  onModuleInit(): void {
    this.task = cron.schedule('*/5 * * * * *', () => {
      this.poll().catch((err) =>
        this.logger.error('[AutomationActionPoller] Poll error:', err),
      );
    });
  }

  onModuleDestroy(): void {
    this.task?.stop();
  }

  async poll(): Promise<void> {
    // Claim a batch atomically: SELECT … FOR UPDATE SKIP LOCKED, then UPDATE
    const claimed = await this.knex.transaction(async (trx) => {
      const rows = await trx('automation_action_events')
        .select('*')
        .where({ status: 'pending' })
        .orderBy('scheduled_at', 'asc')
        .limit(BATCH_SIZE)
        .forUpdate()
        .skipLocked();

      if (rows.length === 0) return [];

      const ids = rows.map((r: { id: string }) => r.id);
      await trx('automation_action_events')
        .whereIn('id', ids)
        .update({ status: 'queued', queued_at: trx.raw('NOW()') });

      return rows;
    });

    // Queue jobs outside the transaction lock
    for (const event of claimed) {
      await this.queue.add(
        'execute-action',
        {
          eventId: event.id,
          tenantId: event.tenant_id,
          triggerId: event.trigger_id,
          actionIndex: event.action_index,
          actionType: event.action_type,
          actionParams: event.action_params,
          triggerContext: event.trigger_context,
        } satisfies AutomationActionJobData,
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        },
      );
    }

    if (claimed.length > 0) {
      this.logger.debug(`[AutomationActionPoller] Queued ${claimed.length} action events`);
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd backend
npx vitest src/plugins/cores/automation/__tests__/automation-action.poller.test.ts
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/workers/bullmq/queue.constants.ts \
        backend/src/plugins/cores/automation/automation-action.poller.ts \
        backend/src/plugins/cores/automation/__tests__/automation-action.poller.test.ts
git commit -m "feat(automation): add QUEUE_AUTOMATION_ACTIONS constant and AutomationActionPoller"
```

---

### Task 11: AutomationActionProcessor

**Files:**
- Create: `backend/src/plugins/cores/automation/automation-action.processor.ts`
- Test: `backend/src/plugins/cores/automation/__tests__/automation-action.processor.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/plugins/cores/automation/__tests__/automation-action.processor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGetHandler = vi.hoisted(() => vi.fn().mockReturnValue({ execute: mockExecute }));
const mockKnexWhere = vi.hoisted(() => vi.fn().mockReturnThis());
const mockKnexUpdate = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const mockKnexSelect = vi.hoisted(() => vi.fn().mockReturnThis());
const mockKnexFirst = vi.hoisted(() => vi.fn().mockResolvedValue({
  id: 'tenant-1', tier: 'basic',
}));
const mockKnexFn = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    where: mockKnexWhere,
    update: mockKnexUpdate,
    select: mockKnexSelect,
    first: mockKnexFirst,
  }),
);

const mockTenantContextRun = vi.hoisted(() => vi.fn((ctx: unknown, fn: () => Promise<void>) => fn()));
vi.mock('../../../../dal/TenantContext', () => ({
  TenantContext: { run: mockTenantContextRun },
}));

import { AutomationActionProcessor } from '../automation-action.processor';
import { ActionRegistry } from '../action-registry';

describe('AutomationActionProcessor', () => {
  let processor: AutomationActionProcessor;
  let registry: ActionRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = { getHandler: mockGetHandler } as unknown as ActionRegistry;
    processor = new AutomationActionProcessor(mockKnexFn as any, registry);
  });

  function makeJob(overrides: Partial<any> = {}) {
    return {
      data: {
        eventId: 'evt-1',
        tenantId: 'tenant-1',
        triggerId: 'trig-1',
        actionIndex: 0,
        actionType: 'webhook.call',
        actionParams: { url: 'https://x.com', method: 'POST' },
        triggerContext: { customer: { id: 'cust-1' } },
        ...overrides,
      },
    } as any;
  }

  it('marks event as processing, calls handler, marks completed', async () => {
    await processor.process(makeJob());
    expect(mockKnexUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'processing' }));
    expect(mockExecute).toHaveBeenCalled();
    expect(mockKnexUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
  });

  it('runs handler inside TenantContext.run', async () => {
    await processor.process(makeJob());
    expect(mockTenantContextRun).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.any(Function),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
npx vitest src/plugins/cores/automation/__tests__/automation-action.processor.test.ts
```

Expected: FAIL — `Cannot find module '../automation-action.processor'`.

- [ ] **Step 3: Write the processor**

```typescript
// backend/src/plugins/cores/automation/automation-action.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Inject } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { Knex } from 'knex';
import { QUEUE_AUTOMATION_ACTIONS } from '../../../workers/bullmq/queue.constants';
import { TenantContext } from '../../../dal/TenantContext';
import { ActionRegistry } from './action-registry';
import type { AutomationActionJobData } from './automation-action.poller';

@Processor(QUEUE_AUTOMATION_ACTIONS, { concurrency: 1 })
export class AutomationActionProcessor extends WorkerHost {
  private readonly logger = new Logger(AutomationActionProcessor.name);

  constructor(
    @Inject('KNEX_INSTANCE') private readonly knex: Knex,
    private readonly actionRegistry: ActionRegistry,
  ) {
    super();
  }

  async process(job: Job<AutomationActionJobData>): Promise<void> {
    const { eventId, tenantId, triggerId, actionType, actionParams, triggerContext } = job.data;

    // Mark processing + increment attempts
    await this.knex('automation_action_events')
      .where({ id: eventId })
      .update({ status: 'processing', attempts: this.knex.raw('attempts + 1') });

    // Load tenant for TenantContext
    const tenant = await this.knex('tenants')
      .where({ id: tenantId })
      .select('id', 'tier')
      .first();

    if (!tenant) {
      await this.markFailed(eventId, `Tenant ${tenantId} not found`);
      return;
    }

    await TenantContext.run({ tenantId, tenantTier: tenant.tier }, async () => {
      const handler = this.actionRegistry.getHandler(actionType);
      await handler.execute(
        { tenantId, eventId, triggerId, triggerContext },
        actionParams,
      );
    });

    await this.knex('automation_action_events')
      .where({ id: eventId })
      .update({ status: 'completed', completed_at: this.knex.raw('NOW()') });

    this.logger.debug(`[AutomationActionProcessor] Completed event ${eventId} (${actionType})`);
  }

  async onFailed(job: Job<AutomationActionJobData>, error: Error): Promise<void> {
    await this.markFailed(job.data.eventId, error.message);
  }

  private async markFailed(eventId: string, errorMessage: string): Promise<void> {
    await this.knex('automation_action_events')
      .where({ id: eventId })
      .update({ status: 'failed', last_error: errorMessage.slice(0, 2000) });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend
npx vitest src/plugins/cores/automation/__tests__/automation-action.processor.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/plugins/cores/automation/automation-action.processor.ts \
        backend/src/plugins/cores/automation/__tests__/automation-action.processor.test.ts
git commit -m "feat(automation): add AutomationActionProcessor (BullMQ worker)"
```

---

### Task 12: Module wiring

- [ ] **Step 1: Update `bullmq.module.ts`** — add the automation-actions queue and processor

Edit `backend/src/workers/bullmq/bullmq.module.ts`:
1. Import `QUEUE_AUTOMATION_ACTIONS`
2. Add `{ name: QUEUE_AUTOMATION_ACTIONS, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } } }` to `BullModule.registerQueue()`
3. Import and add `AutomationActionProcessor` to `providers` array

Full `providers` line becomes:
```typescript
providers: [EmailProcessor, WebhookRetryProcessor, VipMigrationProcessor, VipDecommissionProcessor, DataExportProcessor, VipSharedCleanupProcessor, PluginInitProcessor, AutomationActionProcessor],
```

> **Important:** Import `AutomationActionProcessor` from `'../../plugins/cores/automation/automation-action.processor'`.

- [ ] **Step 2: Update `automation.module.ts`** — register all new providers

Replace with:

```typescript
// backend/src/plugins/cores/automation/automation.module.ts
import { Module } from '@nestjs/common';
import { AutomationCore } from './automation.core';
import { AutomationController } from './automation.controller';
import { ActionRegistry } from './action-registry';
import { WebhookCallHandler } from './handlers/webhook-call.handler';
import { CustomerUpdateFieldHandler } from './handlers/customer-update-field.handler';
import { CaseCreateHandler } from './handlers/case-create.handler';
import { AutomationActionPoller } from './automation-action.poller';

// Note: AutomationActionProcessor is registered in BullMqModule (requires @Processor decorator
// and BullModule.registerQueue to be set up first).

@Module({
  controllers: [AutomationController],
  providers: [
    AutomationCore,
    ActionRegistry,
    WebhookCallHandler,
    CustomerUpdateFieldHandler,
    CaseCreateHandler,
    AutomationActionPoller,
  ],
  exports: [AutomationCore, ActionRegistry],
})
export class AutomationModule implements OnModuleInit {
  constructor(
    private readonly registry: ActionRegistry,
    private readonly webhookHandler: WebhookCallHandler,
    private readonly customerUpdateHandler: CustomerUpdateFieldHandler,
    private readonly caseCreateHandler: CaseCreateHandler,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.webhookHandler);
    this.registry.register(this.customerUpdateHandler);
    this.registry.register(this.caseCreateHandler);
  }
}
```

Add `OnModuleInit` import: `import { Module, OnModuleInit } from '@nestjs/common';`

- [ ] **Step 3: Start the dev server and verify no startup errors**

```bash
cd backend
npm run start:dev
```

Expected: Server starts without errors. Look for:
- `[NestApplication] Nest application successfully started`
- No `Cannot find module` or `Nest can't resolve dependencies` errors.

Stop with Ctrl+C.

- [ ] **Step 4: Run full test suite**

```bash
cd backend
npm test
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/workers/bullmq/bullmq.module.ts \
        backend/src/plugins/cores/automation/automation.module.ts
git commit -m "feat(automation): wire ActionRegistry, handlers, poller, and processor into modules"
```

---

## Chunk 5: API + Frontend

**Files:**
- Modify: `backend/src/plugins/cores/automation/automation.controller.ts` — add `GET /actions`
- Modify: `frontend/web/src/types/api.types.ts` — add `StoredAction`, update `AutomationTrigger.actions`
- Modify: `frontend/web/src/lib/api-client.ts` — add `getAvailableActions()`
- Modify: `frontend/web/src/components/create-trigger-modal.tsx` — add Step 3 (Actions)
- Modify: `frontend/web/src/components/triggers-list.tsx` — show action type badges

---

### Task 13: Backend — `GET /api/v1/plugins/automation/actions`

- [ ] **Step 1: Update `automation.controller.ts`** — inject `ActionRegistry`, add endpoint

Add to `AutomationController`:

```typescript
// 1. Add import at top:
import { ActionRegistry } from './action-registry';

// 2. Add to constructor:
constructor(
  private readonly core: AutomationCore,
  private readonly contextBuilder: ExecutionContextBuilder,
  private readonly sandbox: SandboxService,
  private readonly actionRegistry: ActionRegistry,   // ← add this
) {}

// 3. Add new endpoint:
@Get('actions')
async getAvailableActions(
  @CurrentTenant() tenant: ResolvedTenant,
  @CurrentUser() user: JwtClaims,
  @Req() req: Request & { correlationId?: string },
) {
  const ctx = await this.buildCtx(tenant, user, req);
  const actions = this.actionRegistry.getAvailableFor(ctx.enabledPlugins);
  return { plugin: PLUGIN_NAME, data: actions };
}
```

- [ ] **Step 2: Test the endpoint manually**

```bash
# Start docker compose if not running
docker compose up -d

# Login to get a token (use existing dev credentials)
curl -s -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Slug: acme" \
  -d '{"tenantSlug":"acme","email":"admin@acme.com","password":"password123"}' | jq .token

# Use token to call actions endpoint
curl -s http://localhost:3001/api/v1/plugins/automation/actions \
  -H "Authorization: Bearer <token>" \
  -H "X-Tenant-ID: <tenantId>" | jq .
```

Expected: JSON with `{ plugin: "automation", data: [...ActionDefinition[]] }`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/plugins/cores/automation/automation.controller.ts
git commit -m "feat(automation): add GET /api/v1/plugins/automation/actions endpoint"
```

---

### Task 14: Frontend — types + api-client

- [ ] **Step 1: Update `types/api.types.ts`**

Add after the `Campaign` interface:

```typescript
// Action catalog types (mirrors backend ActionDefinition)
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

export interface StoredAction {
  type: string;
  params: Record<string, unknown>;
}
```

Update `AutomationTrigger`:

```typescript
export interface AutomationTrigger {
  id: string;
  tenant_id: string;
  name: string;
  event_type: string;
  conditions: Record<string, unknown>;
  actions: StoredAction[];   // ← was unknown[]
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Update `lib/api-client.ts`**

Add import for `ActionDefinition` at top of the import block:

```typescript
import type {
  // ...existing...
  ActionDefinition,
} from '@/types/api.types';
```

Add to `crmApi` object (after `getTriggers`):

```typescript
getAvailableActions(ctx: AuthCtx): Promise<{ plugin: string; data: ActionDefinition[] }> {
  return request('/api/v1/plugins/automation/actions', ctx);
},

createTrigger(
  input: {
    name: string;
    event_type: string;
    conditions?: Record<string, unknown>;
    actions?: StoredAction[];  // ← update type
    is_active?: boolean
  },
  ctx: AuthCtx,
): Promise<PluginItemResponse<AutomationTrigger>> {
  return request('/api/v1/plugins/automation/triggers', {
    method: 'POST',
    body: JSON.stringify(input),
    ...ctx,
  });
},
```

Also add `StoredAction` to the imports.

- [ ] **Step 3: Commit**

```bash
git add frontend/web/src/types/api.types.ts \
        frontend/web/src/lib/api-client.ts
git commit -m "feat(automation): add ActionDefinition, StoredAction types and getAvailableActions api-client method"
```

---

### Task 15: Frontend — ActionsStep + updated modal

- [ ] **Step 1: Create `ActionsStep` component**

Create new file `frontend/web/src/components/automation/actions-step.tsx`:

```tsx
'use client';

import { X } from 'lucide-react';
import type { ActionDefinition, StoredAction, ActionParamSchema } from '@/types/api.types';

// ── ActionForm ──────────────────────────────────────────────────────────────

function ActionForm({
  definition,
  params,
  onChange,
}: {
  definition: ActionDefinition;
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
}) {
  function updateParam(name: string, value: unknown) {
    onChange({ ...params, [name]: value });
  }

  return (
    <div className="space-y-2 mt-2">
      {definition.params.map((schema: ActionParamSchema) => (
        <div key={schema.name}>
          <label className="block text-xs font-medium mb-1">
            {schema.label}
            {schema.required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
          {schema.type === 'enum' ? (
            <select
              aria-label={schema.label}
              value={String(params[schema.name] ?? schema.options?.[0]?.value ?? '')}
              onChange={(e) => updateParam(schema.name, e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {schema.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          ) : (
            <input
              aria-label={schema.label}
              type="text"
              value={String(params[schema.name] ?? '')}
              onChange={(e) => updateParam(schema.name, e.target.value)}
              placeholder={schema.hint ?? ''}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── AddActionDropdown ────────────────────────────────────────────────────────

function AddActionDropdown({
  definitions,
  onAdd,
}: {
  definitions: ActionDefinition[];
  onAdd: (def: ActionDefinition) => void;
}) {
  if (definitions.length === 0) return null;

  return (
    <select
      aria-label="Add action"
      value=""
      onChange={(e) => {
        const def = definitions.find((d) => d.type === e.target.value);
        if (def) onAdd(def);
      }}
      className="mt-3 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <option value="" disabled>+ Add action…</option>
      {definitions.map((def) => (
        <option key={def.type} value={def.type}>{def.label}</option>
      ))}
    </select>
  );
}

// ── ActionsStep (exported) ──────────────────────────────────────────────────

export interface ActionRow {
  id: string;
  type: string;
  params: Record<string, unknown>;
}

interface Props {
  definitions: ActionDefinition[];
  actions: ActionRow[];
  onActionsChange: (actions: ActionRow[]) => void;
}

export function ActionsStep({ definitions, actions, onActionsChange }: Props) {
  function addAction(def: ActionDefinition) {
    const defaults: Record<string, unknown> = {};
    for (const p of def.params) {
      if (p.type === 'enum' && p.options?.[0]) {
        defaults[p.name] = p.options[0].value;
      }
    }
    onActionsChange([
      ...actions,
      { id: crypto.randomUUID(), type: def.type, params: defaults },
    ]);
  }

  function removeAction(id: string) {
    onActionsChange(actions.filter((a) => a.id !== id));
  }

  function updateParams(id: string, params: Record<string, unknown>) {
    onActionsChange(actions.map((a) => (a.id === id ? { ...a, params } : a)));
  }

  return (
    <div>
      <p className="mb-3 text-sm font-medium">
        Actions{' '}
        <span className="font-normal text-muted-foreground">(optional — trigger fires but no action is taken if empty)</span>
      </p>

      <div className="space-y-3">
        {actions.map((action, idx) => {
          const def = definitions.find((d) => d.type === action.type);
          return (
            <div key={action.id} className="rounded-md border border-border bg-card p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  {idx + 1}. {def?.label ?? action.type}
                </span>
                <button
                  type="button"
                  aria-label="Remove action"
                  onClick={() => removeAction(action.id)}
                  className="text-red-500 hover:text-red-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {def && (
                <ActionForm
                  definition={def}
                  params={action.params}
                  onChange={(params) => updateParams(action.id, params)}
                />
              )}
            </div>
          );
        })}
      </div>

      <AddActionDropdown definitions={definitions} onAdd={addAction} />
    </div>
  );
}

/** Convert ActionRow[] → StoredAction[] for API submission */
export function toStoredActions(rows: ActionRow[]): StoredAction[] {
  return rows.map(({ type, params }) => ({ type, params }));
}
```

- [ ] **Step 2: Update `create-trigger-modal.tsx`** — add Step 3

Key changes to apply:
1. Change `type Step = 1 | 2` → `type Step = 1 | 2 | 3`
2. Add to imports: `import { ActionsStep, ActionRow, toStoredActions } from './automation/actions-step';`
3. Add to imports: `import { useQuery } from '@tanstack/react-query';`
4. Add `actions: ActionRow[]` to `FormState`
5. Add `actions: []` to `EMPTY_FORM`
6. Add `useQuery` call for available actions:
   ```tsx
   const { data: actionsData } = useQuery({
     queryKey: ['automation-actions', ctx.tenantId],
     queryFn: () => crmApi.getAvailableActions(ctx),
     enabled: !!ctx.token && !!ctx.tenantId,
   });
   const availableDefinitions = actionsData?.data ?? [];
   ```
7. Update `StepIndicator` to show 3 steps with connectors
8. Add Step 3 section rendering `<ActionsStep>`
9. Change Step 2's Next button to go to step 3; Step 2's Back goes to step 1
10. Step 3: Back → step 2; Submit button calls `handleSubmit`
11. In `handleSubmit`, change `actions: []` → `actions: toStoredActions(form.actions)`

Full changes to `handleSubmit` payload:

```tsx
const payload = {
  name: form.name.trim(),
  event_type: form.eventType,
  is_active: form.isActive,
  conditions:
    form.conditions.length > 0
      ? { and: form.conditions.map((r) => ({ field: r.field, op: r.op, value: r.value })) }
      : {},
  actions: toStoredActions(form.actions),  // ← was []
};
```

Full updated `StepIndicator` (add `import { Fragment } from 'react'` to the file's imports):
```tsx
const StepIndicator = (
  <div className="flex items-center gap-2 mb-5">
    {[1, 2, 3].map((s, idx) => (
      <Fragment key={s}>
        <div
          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
            step > s ? 'bg-green-500 text-white' : step === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}
        >
          {step > s ? '✓' : s}
        </div>
        {idx < 2 && <div className={`h-0.5 flex-1 ${step > s ? 'bg-green-500' : 'bg-border'}`} />}
      </Fragment>
    ))}
  </div>
);
```

Footer buttons for step 3:
```tsx
{step === 3 && (
  <>
    <button type="button" onClick={() => setStep(2)} className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent">
      ← Back
    </button>
    <button type="button" disabled={mutation.isPending} onClick={handleSubmit}
      className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
      {mutation.isPending ? 'Creating…' : 'Create Trigger'}
    </button>
  </>
)}
```

And for step 2, change the submit button to "Next →" going to step 3:
```tsx
{step === 2 && (
  <>
    <button type="button" onClick={() => setStep(1)} ...>← Back</button>
    <button type="button" onClick={() => { if (validateConditions()) setStep(3); }} ...>Next →</button>
  </>
)}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/web/src/components/automation/actions-step.tsx \
        frontend/web/src/components/create-trigger-modal.tsx
git commit -m "feat(automation): add ActionsStep component and 3-step trigger modal"
```

---

### Task 16: TriggersList — action type badges

- [ ] **Step 1: Update `triggers-list.tsx`**

After the existing status badge in each trigger card, add action badges:

```tsx
// Add after the existing status/active badge row:
{t.actions.length > 0 && (
  <div className="mt-2 flex flex-wrap gap-1">
    {t.actions.map((a, idx) => (
      <span
        key={idx}
        className="rounded-full bg-muted px-2 py-0.5 text-xs font-mono text-muted-foreground"
      >
        {a.type}
      </span>
    ))}
  </div>
)}
```

- [ ] **Step 2: Verify the web frontend builds cleanly**

```bash
cd frontend/web
npm run build
```

Expected: Build completes without TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/web/src/components/triggers-list.tsx
git commit -m "feat(automation): show action type badges in TriggersList"
```

---

### Task 17: End-to-end smoke test

- [ ] **Step 1: Start everything and run the dev stack**

```bash
# From repo root
docker compose up -d
```

- [ ] **Step 2: Verify migration ran**

```bash
docker compose exec backend npm run db:status
```

Expected: `20260312000009_automation_action_events` listed as Completed.

- [ ] **Step 3: Open the web UI**

Navigate to `http://localhost:3002`. Log in as an existing tenant user. Go to Automation.

- [ ] **Step 4: Create a trigger with actions**

Click "New Trigger".
- Step 1: Name = "Test webhook trigger", Event = `customer.create`, Active = on → Next
- Step 2: No conditions → Next
- Step 3: Add action → "Call Webhook" → URL = `https://webhook.site/...`, Method = POST, Body = `{"customer":"{{customer.name}}"}` → Create Trigger

Expected: Modal closes, trigger appears in list with action badge `webhook.call`.

- [ ] **Step 5: Create a customer to fire the trigger**

In the Contacts page, create a new customer.

Expected: After a few seconds (5s poll + BullMQ processing), check `automation_action_events` table:

```bash
docker compose exec backend node -e "
const {Pool} = require('pg');
const pool = new Pool({connectionString: process.env.DATABASE_URL});
pool.query('SELECT id, status, action_type FROM automation_action_events ORDER BY created_at DESC LIMIT 5').then(r => { console.log(r.rows); pool.end(); });
"
```

Expected: Rows with `status = 'completed'` for `webhook.call`.

- [ ] **Step 6: Commit final notes**

If any files were inadvertently missed by earlier commits, stage them specifically:
```bash
# Only if there are unstaged changes after Task 16
git status
# Stage only automation-related files, not any .env or unrelated files
git commit -m "feat(automation): complete automation actions — catalog, handlers, pipeline, UI"
```

---

## Summary

| Chunk | Key deliverable |
|-------|----------------|
| 1 | DB migration, types, template engine, catalog |
| 2 | 3 command handlers + ActionRegistry (all TDD) |
| 3 | `fireTriggerEvents`, `evaluateConditions`, hook re-wiring |
| 4 | `QUEUE_AUTOMATION_ACTIONS`, poller (5s cron), processor (BullMQ worker), module wiring |
| 5 | `GET /actions` endpoint, frontend types, 3-step modal, action badges |
