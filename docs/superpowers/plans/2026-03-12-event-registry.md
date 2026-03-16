# Event Registry Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a generic `EventRegistry` so any plugin can declare and fire typed events, and the automation plugin connects those events to actions without knowing specific event names in code.

**Architecture:** `EventInfraModule` (@Global) holds `EventRegistryService` (in-memory definitions + DB emit) and `EventPollerService` (cron → BullMQ). `AutomationEventProcessor` consumes `QUEUE_PLUGIN_EVENTS` and routes events to existing `fireTriggerEvents()`. Hooks are preserved for inter-plugin code intervention; automation trigger detection moves entirely to the new event queue.

**Tech Stack:** NestJS, Knex, BullMQ (`@nestjs/bullmq`), Zod, Vitest, React/TanStack Query

**Spec:** `docs/superpowers/specs/2026-03-12-event-registry-design.md`

---

## Chunk 1: Foundation — Migration, Queue Constant, EventRegistryService

### Task 1: Migration — `plugin_events` table

**Files:**
- Create: `backend/src/db/migrations/20260312000010_plugin_events.ts`

- [ ] **Step 1: Create the migration file**

```typescript
// backend/src/db/migrations/20260312000010_plugin_events.ts
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('plugin_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.text('event_name').notNullable();
    t.text('plugin').notNullable();
    t.jsonb('payload').notNullable();
    t.text('status').notNullable().defaultTo('pending'); // pending | queued | processed
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('queued_at', { useTz: true }).nullable();
    t.timestamp('expires_at', { useTz: true }).notNullable();
  });

  // Poller: WHERE status='pending' AND expires_at > NOW()
  await knex.raw(`
    CREATE INDEX plugin_events_pending_idx
      ON plugin_events (status, expires_at)
      WHERE status = 'pending'
  `);

  // Stuck-row recovery: WHERE status='queued' AND queued_at < threshold
  await knex.raw(`
    CREATE INDEX plugin_events_queued_idx
      ON plugin_events (status, queued_at)
      WHERE status = 'queued'
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('plugin_events');
}
```

- [ ] **Step 2: Run the migration**

```bash
cd backend
npm run db:migrate
```

Expected: `Batch N run: 1 migrations`

- [ ] **Step 3: Verify table exists**

```bash
docker compose exec postgres psql -U postgres -d crm_dev -c "\d plugin_events"
```

Expected: table with columns id, tenant_id, event_name, plugin, payload, status, created_at, queued_at, expires_at

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/migrations/20260312000010_plugin_events.ts
git commit -m "feat(events): add plugin_events migration"
```

---

### Task 2: `QUEUE_PLUGIN_EVENTS` constant

**Files:**
- Modify: `backend/src/workers/bullmq/queue.constants.ts`

- [ ] **Step 1: Add the constant**

Add after the last existing constant:

```typescript
export const QUEUE_PLUGIN_EVENTS      = 'plugin-events'         as const;
```

Note: `QUEUE_PLUGIN_INIT = 'plugin-init'` already exists — `plugin-events` is a distinct name.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd backend
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/workers/bullmq/queue.constants.ts
git commit -m "feat(events): add QUEUE_PLUGIN_EVENTS constant"
```

---

### Task 3: `EventDefinition` interface + `EventRegistryService` (TDD)

**Files:**
- Create: `backend/src/plugins/events/event-definition.interface.ts`
- Create: `backend/src/plugins/events/event-registry.service.ts`
- Create: `backend/src/plugins/events/__tests__/event-registry.service.test.ts`

- [ ] **Step 1: Create the interface**

```typescript
// backend/src/plugins/events/event-definition.interface.ts
import type { z } from 'zod';

export interface EventDefinition<T extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  plugin: string;
  description: string;
  schema: T;
}
```

- [ ] **Step 2: Write the failing tests**

```typescript
// backend/src/plugins/events/__tests__/event-registry.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// ── Knex mock ──────────────────────────────────────────────────────────
const mockInsert = vi.hoisted(() => vi.fn().mockResolvedValue([1]));
const mockInto   = vi.hoisted(() => vi.fn().mockReturnThis());
const mockKnexFn = vi.hoisted(() => {
  const fn = vi.fn().mockReturnValue({ insert: mockInsert });
  (fn as any).raw = vi.fn((sql: string) => sql);
  return fn;
});

vi.mock('knex', () => ({ default: vi.fn() }));

import { EventRegistryService } from '../event-registry.service';
import type { EventDefinition } from '../event-definition.interface';

const customerSchema = z.object({
  customer: z.object({ id: z.string().uuid(), name: z.string() }),
});

const customerDef: EventDefinition = {
  name: 'customer.create',
  plugin: 'customer-data',
  description: 'Fired when a customer is created',
  schema: customerSchema,
};

function makeCtx(tenantId = 'tenant-1') {
  return { tenantId } as any;
}

describe('EventRegistryService', () => {
  let svc: EventRegistryService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new EventRegistryService(mockKnexFn as any);
  });

  describe('register / getDefinition / getDefinitions', () => {
    it('returns undefined for unknown event', () => {
      expect(svc.getDefinition('nope')).toBeUndefined();
    });

    it('returns definition after register', () => {
      svc.register(customerDef);
      expect(svc.getDefinition('customer.create')).toBe(customerDef);
    });

    it('getDefinitions returns all registered definitions', () => {
      svc.register(customerDef);
      expect(svc.getDefinitions()).toHaveLength(1);
      expect(svc.getDefinitions()[0].name).toBe('customer.create');
    });
  });

  describe('emit', () => {
    it('throws for unknown event', async () => {
      await expect(svc.emit('no.such', makeCtx(), {})).rejects.toThrow('Unknown event: no.such');
    });

    it('throws when payload fails Zod schema', async () => {
      svc.register(customerDef);
      await expect(
        svc.emit('customer.create', makeCtx(), { customer: { id: 'not-a-uuid', name: 'X' } }),
      ).rejects.toThrow();
    });

    it('INSERTs to plugin_events on valid payload', async () => {
      svc.register(customerDef);
      const payload = { customer: { id: '00000000-0000-0000-0000-000000000001', name: 'Alice' } };
      await svc.emit('customer.create', makeCtx('t-1'), payload);

      expect(mockKnexFn).toHaveBeenCalledWith('plugin_events');
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id:  't-1',
          event_name: 'customer.create',
          plugin:     'customer-data',
          status:     'pending',
        }),
      );
    });

    it('serialises payload as JSON string', async () => {
      svc.register(customerDef);
      const payload = { customer: { id: '00000000-0000-0000-0000-000000000001', name: 'Bob' } };
      await svc.emit('customer.create', makeCtx(), payload);
      const inserted = mockInsert.mock.calls[0][0];
      expect(typeof inserted.payload).toBe('string');
      expect(JSON.parse(inserted.payload)).toEqual(payload);
    });
  });
});
```

- [ ] **Step 3: Run tests — confirm they fail**

```bash
cd backend
npx vitest src/plugins/events/__tests__/event-registry.service.test.ts --reporter=verbose
```

Expected: FAIL — `EventRegistryService` not found

- [ ] **Step 4: Implement `EventRegistryService`**

```typescript
// backend/src/plugins/events/event-registry.service.ts
import { Injectable, Inject } from '@nestjs/common';
import type { Knex } from 'knex';
import type { IExecutionContext } from '../interfaces/execution-context.interface';
import type { EventDefinition } from './event-definition.interface';

const TTL_DAYS = 7;

@Injectable()
export class EventRegistryService {
  private readonly definitions = new Map<string, EventDefinition>();

  constructor(@Inject('KNEX_INSTANCE') private readonly knex: Knex) {}

  register(def: EventDefinition): void {
    this.definitions.set(def.name, def);
  }

  async emit(eventName: string, ctx: IExecutionContext, data: unknown): Promise<void> {
    const def = this.definitions.get(eventName);
    if (!def) throw new Error(`Unknown event: ${eventName}`);

    const payload = def.schema.parse(data);

    await this.knex('plugin_events').insert({
      tenant_id:  ctx.tenantId,
      event_name: eventName,
      plugin:     def.plugin,
      payload:    JSON.stringify(payload),
      status:     'pending',
      expires_at: this.knex.raw(`NOW() + INTERVAL '${TTL_DAYS} days'`),
    });
  }

  getDefinitions(): EventDefinition[] {
    return [...this.definitions.values()];
  }

  getDefinition(name: string): EventDefinition | undefined {
    return this.definitions.get(name);
  }
}
```

- [ ] **Step 5: Run tests — confirm they pass**

```bash
cd backend
npx vitest src/plugins/events/__tests__/event-registry.service.test.ts --reporter=verbose
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/plugins/events/
git commit -m "feat(events): add EventDefinition interface and EventRegistryService (TDD)"
```

---

## Chunk 2: EventPoller + EventInfraModule + PluginInfraModule Wiring + WorkersModule Crons

### Task 4: `EventPollerService` (TDD)

**Files:**
- Create: `backend/src/plugins/events/event-poller.service.ts`
- Create: `backend/src/plugins/events/__tests__/event-poller.service.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// backend/src/plugins/events/__tests__/event-poller.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── BullMQ Queue mock ──────────────────────────────────────────────────
const mockQueueAdd = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockQueue    = vi.hoisted(() => ({ add: mockQueueAdd }));

// ── Knex mock ──────────────────────────────────────────────────────────
const mockRows = vi.hoisted(() => [
  { id: 'evt-1', event_name: 'customer.create', tenant_id: 'ten-1', tenant_tier: 'basic', payload: '{"customer":{"id":"c1"}}' },
]);
const mockUpdate   = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const mockWhereIn  = vi.hoisted(() => vi.fn().mockReturnThis());
const mockLimit    = vi.hoisted(() => vi.fn().mockResolvedValue(mockRows));
const mockSkipLocked = vi.hoisted(() => vi.fn().mockReturnThis());
const mockForUpdate  = vi.hoisted(() => vi.fn().mockReturnThis());
const mockSelect     = vi.hoisted(() => vi.fn().mockReturnThis());
const mockWhere      = vi.hoisted(() => vi.fn().mockReturnThis());
const mockJoin       = vi.hoisted(() => vi.fn().mockReturnThis());

const mockTrx = vi.hoisted(() => {
  const fn = vi.fn().mockReturnValue({
    join: mockJoin,
    where: mockWhere,
    select: mockSelect,
    forUpdate: mockForUpdate,
    skipLocked: mockSkipLocked,
    limit: mockLimit,
    whereIn: mockWhereIn,
    update: mockUpdate,
  });
  return fn;
});

const mockTransaction = vi.hoisted(() =>
  vi.fn((cb: (trx: any) => Promise<void>) => cb(mockTrx)),
);

const mockKnexFn = vi.hoisted(() => {
  const fn = vi.fn().mockReturnValue({
    join: mockJoin,
    where: mockWhere,
    whereIn: mockWhereIn,
    update: mockUpdate,
  });
  (fn as any).transaction = mockTransaction;
  (fn as any).raw = vi.fn((sql: string) => sql);
  return fn;
});

import { EventPollerService } from '../event-poller.service';
import { QUEUE_PLUGIN_EVENTS } from '../../../workers/bullmq/queue.constants';

describe('EventPollerService', () => {
  let svc: EventPollerService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLimit.mockResolvedValue(mockRows);
    svc = new EventPollerService(mockKnexFn as any, mockQueue as any);
  });

  it('does nothing when no pending rows', async () => {
    mockLimit.mockResolvedValueOnce([]);
    await (svc as any).poll();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('marks rows as queued and enqueues each to BullMQ', async () => {
    await (svc as any).poll();

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'queued' }),
    );
    expect(mockQueueAdd).toHaveBeenCalledWith(
      QUEUE_PLUGIN_EVENTS,
      expect.objectContaining({
        eventId:    'evt-1',
        eventName:  'customer.create',
        tenantId:   'ten-1',
        tenantTier: 'basic',
      }),
    );
  });

  it('runs inside a transaction', async () => {
    await (svc as any).poll();
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd backend
npx vitest src/plugins/events/__tests__/event-poller.service.test.ts --reporter=verbose
```

Expected: FAIL — `EventPollerService` not found

- [ ] **Step 3: Implement `EventPollerService`**

```typescript
// backend/src/plugins/events/event-poller.service.ts
import { Injectable, Inject, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Knex } from 'knex';
import { QUEUE_PLUGIN_EVENTS } from '../../workers/bullmq/queue.constants';

const POLL_INTERVAL_MS = 5_000;
const BATCH_SIZE       = 50;

@Injectable()
export class EventPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventPollerService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject('KNEX_INSTANCE') private readonly knex: Knex,
    @InjectQueue(QUEUE_PLUGIN_EVENTS) private readonly queue: Queue,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async poll(): Promise<void> {
    try {
      // Phase 1: DB transaction — SELECT + UPDATE atomically
      // queue.add() happens AFTER commit so a Redis failure leaves the row
      // in 'queued' status; the stuck-row recovery cron resets it to 'pending'.
      let rows: Array<{
        id: string; event_name: string; tenant_id: string;
        tenant_tier: string; payload: string;
      }> = [];

      await this.knex.transaction(async (trx) => {
        rows = await trx('plugin_events as pe')
          .join('tenants as t', 't.id', 'pe.tenant_id')
          .where('pe.status', 'pending')
          .where('pe.expires_at', '>', this.knex.raw('NOW()'))
          .forUpdate()
          .skipLocked()
          .limit(BATCH_SIZE)
          .select(
            'pe.id', 'pe.event_name', 'pe.tenant_id', 'pe.payload',
            't.tier as tenant_tier',
          );

        if (rows.length === 0) return;

        await trx('plugin_events')
          .whereIn('id', rows.map((r) => r.id))
          .update({ status: 'queued', queued_at: this.knex.raw('NOW()') });
      });

      // Phase 2: enqueue AFTER DB commit
      if (rows.length === 0) return;

      await Promise.all(
        rows.map((row) =>
          this.queue.add(QUEUE_PLUGIN_EVENTS, {
            eventId:    row.id,
            eventName:  row.event_name,
            tenantId:   row.tenant_id,
            tenantTier: row.tenant_tier,
            payload:    JSON.parse(row.payload) as Record<string, unknown>,
          }),
        ),
      );

      this.logger.debug(`[EventPoller] queued ${rows.length} event(s)`);
    } catch (err) {
      this.logger.error('[EventPoller] poll error', err);
    }
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
cd backend
npx vitest src/plugins/events/__tests__/event-poller.service.test.ts --reporter=verbose
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/plugins/events/event-poller.service.ts \
        backend/src/plugins/events/__tests__/event-poller.service.test.ts
git commit -m "feat(events): add EventPollerService (TDD)"
```

---

### Task 5: `EventInfraModule` + `PluginInfraModule` wiring

**Files:**
- Create: `backend/src/plugins/events/event-infra.module.ts`
- Modify: `backend/src/plugins/plugin-infra.module.ts`

- [ ] **Step 1: Create `EventInfraModule`**

```typescript
// backend/src/plugins/events/event-infra.module.ts
import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EventRegistryService } from './event-registry.service';
import { EventPollerService } from './event-poller.service';
import { QUEUE_PLUGIN_EVENTS } from '../../workers/bullmq/queue.constants';

@Global()
@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_PLUGIN_EVENTS }),
  ],
  providers: [
    EventRegistryService,
    EventPollerService,
  ],
  exports: [
    EventRegistryService,
  ],
})
export class EventInfraModule {}
```

- [ ] **Step 2: Import and re-export in `PluginInfraModule`**

In `backend/src/plugins/plugin-infra.module.ts`, add to `imports` array:

```typescript
import { EventInfraModule } from './events/event-infra.module';
```

Add `EventInfraModule` to `imports: [ObservabilityModule, EventInfraModule]`

Add `EventInfraModule` to `exports: [...existing..., EventInfraModule]`

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd backend
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add backend/src/plugins/events/event-infra.module.ts \
        backend/src/plugins/plugin-infra.module.ts
git commit -m "feat(events): add EventInfraModule, wire into PluginInfraModule"
```

---

### Task 6: WorkersModule crons — stuck-row recovery + expired-row cleanup

**Files:**
- Modify: `backend/src/workers/scheduler/cron.service.ts`

- [ ] **Step 1: Add Knex injection and two new cron jobs to `CronService`**

Add import at top:
```typescript
import { Inject } from '@nestjs/common';  // already imported — just add Inject if missing
import type { Knex } from 'knex';
```

The existing constructor has three params (`emailQueue`, `webhookQueue`, `poolRegistry`). Add `knex` as a fourth:
```typescript
constructor(
  @InjectQueue(QUEUE_EMAIL)   private readonly emailQueue:   Queue,
  @InjectQueue(QUEUE_WEBHOOK) private readonly webhookQueue: Queue,
  private readonly poolRegistry: PoolRegistry,
  @Inject('KNEX_INSTANCE') private readonly knex: Knex,  // ADD THIS
) {}
```

Add two new `cron.schedule` calls in `onApplicationBootstrap()`:

```typescript
// ── Every 10 min — reset stuck plugin_events (queued but not processed) ──
this.tasks.push(
  cron.schedule('*/10 * * * *', () => void this.resetStuckPluginEvents(), {
    name: 'reset-stuck-plugin-events',
  })
);

// ── Daily at 02:30 — purge expired plugin_events ────────────────────
this.tasks.push(
  cron.schedule('30 2 * * *', () => void this.purgeExpiredPluginEvents(), {
    name: 'purge-expired-plugin-events',
  })
);
```

Update the log line count: `'CronService started (5 jobs scheduled)'`

Add the two private methods:

```typescript
private async resetStuckPluginEvents(): Promise<void> {
  try {
    const count = await this.knex('plugin_events')
      .where({ status: 'queued' })
      .where('queued_at', '<', this.knex.raw(`NOW() - INTERVAL '15 minutes'`))
      .update({ status: 'pending', queued_at: null });
    if (count > 0) {
      this.logger.warn(`cron:reset-stuck-plugin-events — reset ${count} stuck row(s)`);
    }
  } catch (err) {
    this.logger.error('cron:reset-stuck-plugin-events failed', err);
  }
}

private async purgeExpiredPluginEvents(): Promise<void> {
  try {
    const count = await this.knex('plugin_events')
      .where('expires_at', '<', this.knex.raw('NOW()'))
      .delete();
    this.logger.log(`cron:purge-expired-plugin-events — deleted ${count} row(s)`);
  } catch (err) {
    this.logger.error('cron:purge-expired-plugin-events failed', err);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd backend
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/workers/scheduler/cron.service.ts
git commit -m "feat(events): add stuck-row recovery and expired-row cleanup crons"
```

---

## Chunk 3: ExecutionContextBuilder + AutomationEventProcessor + Module Wiring

### Task 7: `ExecutionContextBuilder.buildForWorker()` (TDD)

**Files:**
- Modify: `backend/src/plugins/context/execution-context-builder.service.ts`
- Modify (tests): `backend/src/plugins/context/__tests__/execution-context-builder.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Check if a test file exists: `ls backend/src/plugins/context/__tests__/` — create the test file if absent.

```typescript
// backend/src/plugins/context/__tests__/execution-context-builder.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetEnabledPlugins = vi.hoisted(() =>
  vi.fn().mockResolvedValue(['customer-data', 'automation']),
);
const mockKnex = vi.hoisted(() => ({} as any));
const mockCache = vi.hoisted(() => ({} as any));
const mockPool  = vi.hoisted(() => ({} as any));

import { ExecutionContextBuilder } from '../execution-context-builder.service';
import { PluginRegistryService } from '../../registry/plugin-registry.service';

describe('ExecutionContextBuilder.buildForWorker', () => {
  let builder: ExecutionContextBuilder;
  let registry: PluginRegistryService;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = { getEnabledPlugins: mockGetEnabledPlugins } as unknown as PluginRegistryService;
    builder = new ExecutionContextBuilder(mockKnex, mockCache, mockPool, registry);
  });

  it('returns ExecutionContext with correct tenantId and tier', async () => {
    const ctx = await builder.buildForWorker('ten-1', 'premium', 'req-abc');
    expect(ctx.tenantId).toBe('ten-1');
    expect(ctx.tenantTier).toBe('premium');  // field is tenantTier, not tier
  });

  it('fetches enabledPlugins via PluginRegistryService', async () => {
    await builder.buildForWorker('ten-1', 'basic', 'req-abc');
    expect(mockGetEnabledPlugins).toHaveBeenCalledWith('ten-1', mockCache, mockPool);
  });

  it('sets enabledPlugins from registry result', async () => {
    const ctx = await builder.buildForWorker('ten-1', 'basic', 'req-abc');
    expect(ctx.enabledPlugins).toEqual(['customer-data', 'automation']);
  });
});
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
cd backend
npx vitest src/plugins/context/__tests__/execution-context-builder.test.ts --reporter=verbose
```

Expected: FAIL — `buildForWorker` is not a function

- [ ] **Step 3: Add `buildForWorker()` to `ExecutionContextBuilder`**

In `execution-context-builder.service.ts`, add after the existing `build()` method:

```typescript
async buildForWorker(
  tenantId: string,
  tenantTier: string,
  requestId: string,
): Promise<ExecutionContext> {
  const enabledPlugins = await this.pluginRegistry.getEnabledPlugins(
    tenantId,
    this.cacheManager,
    this.poolRegistry,
  );

  const db: IDbContext = {
    db: this.knex,
    transaction: (fn) => this.knex.transaction(fn),
  };

  return new ExecutionContext(
    tenantId,
    tenantTier,
    {},
    enabledPlugins,
    'system',   // no user in worker context
    [],
    requestId,
    db,
    this.cacheManager,
  );
}
```

- [ ] **Step 4: Run test — confirm it passes**

```bash
cd backend
npx vitest src/plugins/context/__tests__/execution-context-builder.test.ts --reporter=verbose
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/plugins/context/execution-context-builder.service.ts \
        backend/src/plugins/context/__tests__/
git commit -m "feat(events): add ExecutionContextBuilder.buildForWorker (TDD)"
```

---

### Task 8: `AutomationEventProcessor` (TDD)

**Files:**
- Create: `backend/src/plugins/cores/automation/automation-event.processor.ts`
- Create: `backend/src/plugins/cores/automation/__tests__/automation-event.processor.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// backend/src/plugins/cores/automation/__tests__/automation-event.processor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks (vi.hoisted — must be before imports) ───────────────────────
const mockFireTriggerEvents = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockBuildForWorker    = vi.hoisted(() => vi.fn().mockResolvedValue({ tenantId: 'ten-1' }));
const mockTenantContextRun  = vi.hoisted(() =>
  vi.fn((_ctx: unknown, fn: () => Promise<void>) => fn()),
);
const mockKnexUpdate = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const mockKnexWhere  = vi.hoisted(() => vi.fn().mockReturnThis());
const mockKnexFn     = vi.hoisted(() =>
  vi.fn().mockReturnValue({ where: mockKnexWhere, update: mockKnexUpdate }),
);

vi.mock('../../../../dal/context/TenantContext', () => ({
  TenantContext: { run: mockTenantContextRun },
}));

import { AutomationEventProcessor } from '../automation-event.processor';

function makeProcessor() {
  const core    = { fireTriggerEvents: mockFireTriggerEvents } as any;
  const builder = { buildForWorker: mockBuildForWorker }      as any;
  return new AutomationEventProcessor(mockKnexFn as any, core, builder);
}

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      eventId:    'evt-1',
      eventName:  'customer.create',
      tenantId:   'ten-1',
      tenantTier: 'basic',
      payload:    { customer: { id: 'cust-1', name: 'Alice' } },
      ...overrides,
    },
    opts:         { attempts: 3 },
    attemptsMade: 1,
  } as any;
}

describe('AutomationEventProcessor', () => {
  let processor: AutomationEventProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = makeProcessor();
  });

  it('runs inside TenantContext', async () => {
    await processor.process(makeJob());
    expect(mockTenantContextRun).toHaveBeenCalledWith(
      { tenantId: 'ten-1', tenantTier: 'basic' },
      expect.any(Function),
    );
  });

  it('builds worker context and calls fireTriggerEvents', async () => {
    await processor.process(makeJob());
    expect(mockBuildForWorker).toHaveBeenCalledWith('ten-1', 'basic', 'evt-1');
    expect(mockFireTriggerEvents).toHaveBeenCalledWith(
      { tenantId: 'ten-1' },
      'customer.create',
      { customer: { id: 'cust-1', name: 'Alice' } },
    );
  });

  it('marks plugin_event as processed on success', async () => {
    await processor.process(makeJob());
    expect(mockKnexFn).toHaveBeenCalledWith('plugin_events');
    expect(mockKnexWhere).toHaveBeenCalledWith({ id: 'evt-1' });
    expect(mockKnexUpdate).toHaveBeenCalledWith({ status: 'processed' });
  });

  it('onFailed: resets to pending only after max retries exhausted', async () => {
    const job = makeJob();
    job.attemptsMade = 3; // equal to opts.attempts — exhausted
    await processor.onFailed(job, new Error('boom'));
    expect(mockKnexUpdate).toHaveBeenCalledWith({ status: 'pending', queued_at: null });
  });

  it('onFailed: does NOT reset if retries remain', async () => {
    const job = makeJob();
    job.attemptsMade = 1; // attempts=3, still has retries left
    await processor.onFailed(job, new Error('transient'));
    expect(mockKnexUpdate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd backend
npx vitest src/plugins/cores/automation/__tests__/automation-event.processor.test.ts --reporter=verbose
```

Expected: FAIL — `AutomationEventProcessor` not found

- [ ] **Step 3: Implement `AutomationEventProcessor`**

```typescript
// backend/src/plugins/cores/automation/automation-event.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { Knex } from 'knex';
import { QUEUE_PLUGIN_EVENTS } from '../../../workers/bullmq/queue.constants';
import { TenantContext } from '../../../dal/context/TenantContext';
import { AutomationCore } from './automation.core';
import { ExecutionContextBuilder } from '../../context/execution-context-builder.service';

export interface PluginEventJobData {
  eventId:    string;
  eventName:  string;
  tenantId:   string;
  tenantTier: string;
  payload:    Record<string, unknown>;
}

@Processor(QUEUE_PLUGIN_EVENTS, { concurrency: 1 })
export class AutomationEventProcessor extends WorkerHost {
  private readonly logger = new Logger(AutomationEventProcessor.name);

  constructor(
    @Inject('KNEX_INSTANCE') private readonly knex: Knex,
    private readonly automationCore: AutomationCore,
    private readonly contextBuilder: ExecutionContextBuilder,
  ) {
    super();
  }

  async process(job: Job<PluginEventJobData>): Promise<void> {
    const { eventId, eventName, tenantId, tenantTier, payload } = job.data;

    await TenantContext.run({ tenantId, tenantTier }, async () => {
      const ctx = await this.contextBuilder.buildForWorker(tenantId, tenantTier, eventId);
      await this.automationCore.fireTriggerEvents(ctx, eventName, payload);
    });

    await this.knex('plugin_events')
      .where({ id: eventId })
      .update({ status: 'processed' });

    this.logger.debug(`[AutomationEventProcessor] processed event ${eventId} (${eventName})`);
  }

  async onFailed(job: Job<PluginEventJobData>, error: Error): Promise<void> {
    const maxAttempts = job.opts?.attempts ?? 1;
    if (job.attemptsMade >= maxAttempts) {
      this.logger.warn(
        `[AutomationEventProcessor] event ${job.data.eventId} exhausted retries — resetting to pending`,
      );
      await this.knex('plugin_events')
        .where({ id: job.data.eventId })
        .update({ status: 'pending', queued_at: null });
    }
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
cd backend
npx vitest src/plugins/cores/automation/__tests__/automation-event.processor.test.ts --reporter=verbose
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/plugins/cores/automation/automation-event.processor.ts \
        backend/src/plugins/cores/automation/__tests__/automation-event.processor.test.ts
git commit -m "feat(events): add AutomationEventProcessor (TDD)"
```

---

### Task 9: Wire `AutomationEventProcessor` into `AutomationModule`

**Files:**
- Modify: `backend/src/plugins/cores/automation/automation.module.ts`

- [ ] **Step 1: Update `AutomationModule`**

Add imports:
```typescript
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_PLUGIN_EVENTS } from '../../../workers/bullmq/queue.constants';
import { AutomationEventProcessor } from './automation-event.processor';
```

Add to `imports` array: `BullModule.registerQueue({ name: QUEUE_PLUGIN_EVENTS })`

Add `AutomationEventProcessor` to `providers` array.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd backend
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/plugins/cores/automation/automation.module.ts
git commit -m "feat(events): wire AutomationEventProcessor into AutomationModule"
```

---

## Chunk 4: Plugin Wiring — customer-data emit, automation hook removal, GET /events

### Task 10: `customer-data` — register event definition + emit

**Prerequisite:** Confirm Task 5 (`EventInfraModule` imported and re-exported by `PluginInfraModule`) is complete before this task. Otherwise `EventRegistryService` will not be in the global DI container and injection will fail at runtime.

**Files:**
- Modify: `backend/src/plugins/cores/customer-data/customer-data.core.ts`

- [ ] **Step 1: Add `EventRegistryService` injection**

Add import:
```typescript
import { z } from 'zod';
import { EventRegistryService } from '../../events/event-registry.service';
```

Add to constructor:
```typescript
private readonly eventRegistry: EventRegistryService,
```

- [ ] **Step 2: Register event definition in `onModuleInit()`**

Add after `this.registry.register(this)`:

```typescript
this.eventRegistry.register({
  name: 'customer.create',
  plugin: 'customer-data',
  description: 'Fired when a new customer is created',
  // Payload wrapped as { customer } — matches triggerContext shape in fireTriggerEvents
  schema: z.object({
    customer: z.object({
      id:      z.string().uuid(),
      name:    z.string(),
      email:   z.string().email().nullable(),
      phone:   z.string().nullable(),
      company: z.string().nullable(),
    }),
  }),
});
```

- [ ] **Step 3: Add `emit()` call in `createCustomer()`**

In `createCustomer()`, after the existing `await this.hookRegistry.runAfter('customer.create', ctx, customer)` line, add:

```typescript
await this.eventRegistry.emit('customer.create', ctx, { customer });
```

Both calls must remain — the `runAfter` fires customer-care's hook; the `emit` triggers automation.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd backend
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Run all automation tests to catch regressions**

```bash
cd backend
npx vitest src/plugins/cores/automation/ --reporter=verbose
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/plugins/cores/customer-data/customer-data.core.ts
git commit -m "feat(events): customer-data registers and emits customer.create event"
```

---

### Task 11: Remove hook-based trigger detection from automation

**Files:**
- Modify: `backend/src/plugins/cores/automation/automation.core.ts`
- Modify: `backend/src/plugins/manifest/built-in-manifests.ts`

- [ ] **Step 1: Remove hook registration from `AutomationCore.onModuleInit()`**

In `automation.core.ts`, delete the entire `hookRegistry.register(...)` block from `onModuleInit()`:

```typescript
// DELETE this entire block:
this.hookRegistry.register(
  'automation',
  { event: 'customer.create', type: 'after', priority: 20 },
  async (ctx: IExecutionContext, data: unknown) => {
    const customer = data as Record<string, unknown>;
    await this.fireTriggerEvents(ctx, 'customer.create', { customer });
  },
);
```

If `hookRegistry` is no longer used in `onModuleInit()`, remove the `HookRegistryService` injection from the constructor and import as well (only if it is not used elsewhere in the class — check with grep).

- [ ] **Step 2: Clear `AUTOMATION_MANIFEST.hooks`**

In `built-in-manifests.ts`, change:

```typescript
// FROM:
hooks: [
  { event: 'customer.create', type: 'after', priority: 20 },
],
// TO:
hooks: [],
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd backend
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Run full test suite**

```bash
cd backend
npm test
```

Expected: all PASS — the hook-based path is removed, event-based path will be tested via integration

- [ ] **Step 5: Commit**

```bash
git add backend/src/plugins/cores/automation/automation.core.ts \
        backend/src/plugins/manifest/built-in-manifests.ts
git commit -m "feat(events): remove hook-based trigger detection from AutomationCore"
```

---

### Task 12: `GET /api/v1/plugins/automation/events` endpoint

**Prerequisite:** Confirm Task 5 (`EventInfraModule` imported and re-exported by `PluginInfraModule`) is complete before this task.

**Files:**
- Modify: `backend/src/plugins/cores/automation/automation.controller.ts`

- [ ] **Step 1: Add `EventRegistryService` injection and the endpoint**

Add import:
```typescript
import { EventRegistryService } from '../../events/event-registry.service';
import { z } from 'zod';
```

Add to constructor:
```typescript
private readonly eventRegistry: EventRegistryService,
```

Add helper function before the class (or as a private static method):

```typescript
// NOTE: event schemas wrap the root entity under a named key (e.g. { customer: z.object({...}) }).
// We access the inner shape by the convention key 'customer'. ZodNullable fields fall through
// to the 'string' default — this is acceptable for the condition builder UI.
function schemaToFields(def: import('../../events/event-definition.interface').EventDefinition): { name: string; type: string }[] {
  const topShape = (def.schema as z.ZodObject<z.ZodRawShape>).shape;
  // Unwrap one level using the first key (entity name, e.g. 'customer')
  const entityKey = Object.keys(topShape)[0];
  const innerShape = topShape[entityKey] instanceof z.ZodObject
    ? (topShape[entityKey] as z.ZodObject<z.ZodRawShape>).shape
    : topShape;
  return Object.entries(innerShape).map(([name, field]) => ({
    name,
    type: field instanceof z.ZodString  ? 'string'
        : field instanceof z.ZodNumber  ? 'number'
        : field instanceof z.ZodBoolean ? 'boolean'
        : 'string',
  }));
}
```

Add the new endpoint. Note: use the existing `buildCtx()` helper (established controller pattern) instead of inline ctx-build:

```typescript
@Get('events')
async getAvailableEvents(
  @CurrentTenant() tenant: ResolvedTenant,
  @CurrentUser() user: JwtClaims,
  @Req() req: Request & { correlationId?: string },
) {
  const ctx = await this.buildCtx(tenant, user, req);

  return {
    plugin: 'automation',
    data: this.eventRegistry
      .getDefinitions()
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

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd backend
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Smoke test (requires running stack)**

```bash
# In a separate terminal: docker compose up -d
curl -s -H "Authorization: Bearer $TOKEN" \
     -H "X-Tenant-ID: $TENANT_ID" \
     http://localhost:3001/api/v1/plugins/automation/events | jq .
```

Expected: `{ "plugin": "automation", "data": [{ "name": "customer.create", ... }] }`

- [ ] **Step 4: Commit**

```bash
git add backend/src/plugins/cores/automation/automation.controller.ts
git commit -m "feat(events): add GET /automation/events endpoint"
```

---

## Chunk 5: Frontend — Dynamic Event List + Condition Fields

### Task 13: `api-client.ts` + `CreateTriggerModal` dynamic events

**Files:**
- Modify: `frontend/web/src/lib/api-client.ts`
- Modify: `frontend/web/src/types/api.types.ts`
- Modify: `frontend/web/src/components/create-trigger-modal.tsx`

- [ ] **Step 1: Add `EventField` and `AvailableEvent` types**

In `frontend/web/src/types/api.types.ts`, add:

```typescript
export interface EventField {
  name: string;
  type: 'string' | 'number' | 'boolean';
}

export interface AvailableEvent {
  name:        string;
  plugin:      string;
  description: string;
  fields:      EventField[];
}
```

- [ ] **Step 2: Add `getAvailableEvents()` to api-client**

In `frontend/web/src/lib/api-client.ts`, add inside `crmApi` object (near other automation methods):

```typescript
getAvailableEvents(ctx: AuthCtx): Promise<{ plugin: string; data: AvailableEvent[] }> {
  return request('/api/v1/plugins/automation/events', ctx);
},
```

Add `AvailableEvent` to the import from `@/types/api.types`.

- [ ] **Step 3: Update `CreateTriggerModal` — replace hard-coded event list with dynamic query**

In `frontend/web/src/components/create-trigger-modal.tsx`:

Add `useQuery` to the `@tanstack/react-query` import (currently only `useMutation` is imported):
```typescript
import { useMutation, useQuery } from '@tanstack/react-query';
```

Add query alongside the existing `actionsQuery`:

```typescript
const eventsQuery = useQuery({
  queryKey: ['automation-events', ctx.tenantId],
  queryFn:  () => crmApi.getAvailableEvents(ctx),
  enabled:  open && Boolean(ctx.token && ctx.tenantId),
});
const availableEvents = eventsQuery.data?.data ?? [];
```

Also update `EMPTY_FORM` to default `eventType` to `''` (empty) so the user must select from the dynamic list instead of inheriting a hard-coded default:
```typescript
// Change: eventType: EVENT_TYPES[0]
// To:
eventType: '',
```

Replace the hard-coded `<select>` for `event_type` (Step 1 of the wizard) with a dynamic one:

```tsx
<select
  value={form.eventType}
  onChange={(e) => setForm({ ...form, eventType: e.target.value })}
  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
>
  <option value="">— select event —</option>
  {availableEvents.map((ev) => (
    <option key={ev.name} value={ev.name}>{ev.name} — {ev.description}</option>
  ))}
</select>
```

- [ ] **Step 4: Update condition builder to use event fields**

The condition builder's field `<select>` currently shows hard-coded fields. Update it to derive fields from the selected event:

```typescript
const selectedEventFields: EventField[] = availableEvents
  .find((ev) => ev.name === form.eventType)
  ?.fields ?? [];
```

In the condition row's field dropdown, replace hard-coded options with:

```tsx
{selectedEventFields.map((f) => (
  <option key={f.name} value={f.name}>{f.name}</option>
))}
```

**Important:** The field value stored in conditions must be the plain field name (e.g. `'name'`, `'email'`), NOT `customer.name`. `evaluateConditions()` in `automation.core.ts` indexes directly into `triggerContext.customer[rule.field]` — a `customer.` prefix would produce `undefined` and all conditions would silently fail.

Also update `makeRow()` and `conditionsToRows()` which currently reference the `ATTRIBUTES` constant (which will be removed). Replace `ATTRIBUTES[0]` with `selectedEventFields[0]?.name ?? ''` — since `makeRow` is called inside the component, pass `fields` as a parameter or inline the default from `selectedEventFields`:

```typescript
// Replace makeRow() default field:
// FROM: field: ATTRIBUTES[0]
// TO:   field: ''   (empty default; user must choose from dropdown)
```

Similarly update `conditionsToRows()` fallback:
```typescript
// FROM: field: ATTRIBUTES[0] ?? ''
// TO:   field: rule.field ?? ''
```

Remove the `ATTRIBUTES` and `EVENT_TYPES` constants (and their imports if any) once they are no longer referenced.

- [ ] **Step 5: Build frontend to verify no TypeScript errors**

```bash
cd frontend/web
npm run build
```

Expected: build succeeds with no TypeScript errors

- [ ] **Step 6: Commit**

```bash
git add frontend/web/src/types/api.types.ts \
        frontend/web/src/lib/api-client.ts \
        frontend/web/src/components/create-trigger-modal.tsx
git commit -m "feat(events): frontend — dynamic event list and condition fields in CreateTriggerModal"
```

---

## Final Verification

- [ ] **Run full backend test suite**

```bash
cd backend
npm test
```

Expected: all PASS

- [ ] **Run full stack smoke test**

```bash
docker compose up -d
docker compose exec backend npm run db:migrate
# Create a customer via UI or API — verify automation_action_events is populated
# (end-to-end: customer.create → plugin_events → QUEUE_PLUGIN_EVENTS → AutomationEventProcessor → automation_action_events)
```

- [ ] **Final commit tag**

```bash
git tag event-registry-v1
```
