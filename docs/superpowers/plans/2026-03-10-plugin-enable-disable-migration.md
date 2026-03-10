# Plugin Enable/Disable — Soft Migration & Audit Log Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete `togglePlugin()` with first-enable async init job (BullMQ), audit logging, and userId tracking.

**Architecture:** Add `initialized_at TIMESTAMPTZ NULL` to `tenant_plugins`. On first enable, enqueue `QUEUE_PLUGIN_INIT` to `PluginInitProcessor` (all Phase 5 no-ops). Add `publishAudit()` for both enable and disable. Add `userId` param threaded from controller JWT to service.

**Tech Stack:** NestJS 10, TypeScript 5, BullMQ (`@nestjs/bullmq`), Knex, Vitest (globals: true, `vi.hoisted()` required for mock vars)

**Spec:** `docs/superpowers/specs/2026-03-10-plugin-enable-disable-migration-design.md`

---

## Chunk 1: DB Migration + Queue Constant

### Task 1: Create DB migration

**Files:**
- Create: `backend/src/db/migrations/20260310000009_plugin_init.ts`

- [ ] **Step 1: Create the migration file**

```typescript
// backend/src/db/migrations/20260310000009_plugin_init.ts
import type { Knex } from 'knex';

// ============================================================
// V9 — plugin_init: add initialized_at to tenant_plugins
//
// Tracks whether a plugin's first-enable init job has completed
// for a given tenant. NULL = never initialized or init pending.
// Set to NOW() by PluginInitProcessor on job completion.
// ============================================================

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('tenant_plugins', (table) => {
    table.timestamp('initialized_at', { useTz: true }).nullable().defaultTo(null);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('tenant_plugins', (table) => {
    table.dropColumn('initialized_at');
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/leo/Projects/VCC/crm-multi-tenant-saas-architecture/backend
npx tsc --noEmit 2>&1 | grep "20260310000009" | head -5
```

Expected: no errors for this file.

### Task 2: Add QUEUE_PLUGIN_INIT constant

**Files:**
- Modify: `backend/src/workers/bullmq/queue.constants.ts`

- [ ] **Step 1: Add constant**

Open `backend/src/workers/bullmq/queue.constants.ts` and add at the end:

```typescript
export const QUEUE_PLUGIN_INIT    = 'plugin-init'          as const;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/leo/Projects/VCC/crm-multi-tenant-saas-architecture/backend
npx tsc --noEmit 2>&1 | grep "queue.constants" | head -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/leo/Projects/VCC/crm-multi-tenant-saas-architecture/backend
git add src/db/migrations/20260310000009_plugin_init.ts \
        src/workers/bullmq/queue.constants.ts
git commit -m "feat(plugins): add plugin_init migration and QUEUE_PLUGIN_INIT constant"
```

---

## Chunk 2: PluginInitProcessor

### Task 3: Create PluginInitProcessor + register in modules

**Files:**
- Create: `backend/src/workers/bullmq/processors/plugin-init.processor.ts`
- Create: `backend/src/workers/bullmq/processors/__tests__/plugin-init.processor.test.ts`
- Modify: `backend/src/workers/bullmq/bullmq.module.ts`
- Modify: `backend/src/api/v1/admin/admin.module.ts`

- [ ] **Step 1: Write failing tests**

Create `backend/src/workers/bullmq/processors/__tests__/plugin-init.processor.test.ts`:

```typescript
import { PluginInitProcessor, PluginInitJobData } from '../plugin-init.processor';
import { PoolRegistry } from '../../../../dal/pool/PoolRegistry';
import type { Job } from 'bullmq';

const mockQuery   = vi.hoisted(() => vi.fn());
const mockRelease = vi.hoisted(() => vi.fn());
const mockAcquire = vi.hoisted(() => vi.fn());

vi.mock('../../../../dal/pool/PoolRegistry', () => ({
  PoolRegistry: vi.fn().mockImplementation(() => ({
    acquireMetadataConnection: mockAcquire,
  })),
}));

const makeJob = (data: PluginInitJobData): Job<PluginInitJobData> => ({ data } as any);

describe('PluginInitProcessor', () => {
  let processor: PluginInitProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAcquire.mockResolvedValue({ query: mockQuery, release: mockRelease });
    processor = new PluginInitProcessor(new (PoolRegistry as any)());
  });

  it('sets initialized_at when initialized_at is null', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ initialized_at: null }] })  // SELECT
      .mockResolvedValueOnce({ rows: [] });                          // UPDATE

    await processor.process(makeJob({ tenantId: 'tid', pluginId: 'customer-data' }));

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[1][0]).toContain('SET initialized_at = NOW()');
  });

  it('returns early without UPDATE when already initialized (idempotency)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ initialized_at: '2026-03-10T00:00:00Z' }] });

    await processor.process(makeJob({ tenantId: 'tid', pluginId: 'customer-data' }));

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('sets initialized_at when no prior tenant_plugins row exists', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })    // SELECT returns empty
      .mockResolvedValueOnce({ rows: [] });   // UPDATE

    await processor.process(makeJob({ tenantId: 'tid', pluginId: 'analytics' }));

    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it.each(['customer-data', 'customer-care', 'analytics', 'automation', 'marketing'])(
    'completes without error for built-in plugin: %s',
    async (pluginId) => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ initialized_at: null }] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(
        processor.process(makeJob({ tenantId: 'tid', pluginId })),
      ).resolves.not.toThrow();
    },
  );

  it('always releases DB client even on error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'));

    await expect(
      processor.process(makeJob({ tenantId: 'tid', pluginId: 'customer-data' })),
    ).rejects.toThrow('DB error');

    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests — confirm FAIL**

```bash
cd /home/leo/Projects/VCC/crm-multi-tenant-saas-architecture/backend
npx vitest run src/workers/bullmq/processors/__tests__/plugin-init.processor.test.ts 2>&1 | tail -10
```

Expected: fail — `Cannot find module '../plugin-init.processor'`

- [ ] **Step 3: Implement the processor**

Create `backend/src/workers/bullmq/processors/plugin-init.processor.ts`:

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE_PLUGIN_INIT } from '../queue.constants';
import { PoolRegistry } from '../../../dal/pool/PoolRegistry';

export interface PluginInitJobData {
  tenantId: string;
  pluginId: string;
}

@Processor(QUEUE_PLUGIN_INIT, { concurrency: 5 })
export class PluginInitProcessor extends WorkerHost {
  private readonly logger = new Logger(PluginInitProcessor.name);

  constructor(private readonly poolRegistry: PoolRegistry) {
    super();
  }

  async process(job: Job<PluginInitJobData>): Promise<void> {
    const { tenantId, pluginId } = job.data;
    this.logger.log(`[PluginInit] Starting for tenant ${tenantId}, plugin ${pluginId}`);

    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      // Idempotency: re-check initialized_at before doing work (safe on BullMQ retry)
      const { rows } = await client.query<{ initialized_at: string | null }>(
        `SELECT initialized_at FROM tenant_plugins WHERE tenant_id = $1 AND plugin_name = $2`,
        [tenantId, pluginId],
      );
      if (rows[0]?.initialized_at) {
        this.logger.log(`[PluginInit] Already initialized — skipping`);
        return;
      }

      // Per-plugin init logic (Phase 5: all no-ops — tables already exist in shared schema)
      await this.runInitFor(pluginId, tenantId);

      // Mark complete
      await client.query(
        `UPDATE tenant_plugins SET initialized_at = NOW() WHERE tenant_id = $1 AND plugin_name = $2`,
        [tenantId, pluginId],
      );

      this.logger.log(`[PluginInit] Completed for tenant ${tenantId}, plugin ${pluginId}`);
    } finally {
      client.release();
    }
  }

  // Extension point for Phase 6 plugins to add real init logic.
  private async runInitFor(pluginId: string, _tenantId: string): Promise<void> {
    switch (pluginId) {
      case 'customer-data':
      case 'customer-care':
      case 'analytics':
      case 'automation':
      case 'marketing':
        this.logger.debug(`[PluginInit] No-op init for built-in plugin: ${pluginId}`);
        break;
      default:
        this.logger.warn(`[PluginInit] Unknown plugin '${pluginId}' — skipping init`);
    }
  }
}
```

- [ ] **Step 4: Run tests — confirm all PASS**

```bash
cd /home/leo/Projects/VCC/crm-multi-tenant-saas-architecture/backend
npx vitest run src/workers/bullmq/processors/__tests__/plugin-init.processor.test.ts 2>&1 | tail -10
```

Expected: all 9 tests pass.

- [ ] **Step 5: Register in BullMqModule**

Open `backend/src/workers/bullmq/bullmq.module.ts`.

Add import at top:
```typescript
import { QUEUE_PLUGIN_INIT } from './queue.constants';
import { PluginInitProcessor } from './processors/plugin-init.processor';
```

Add `{ name: QUEUE_PLUGIN_INIT, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 3000 } } }` to the `BullModule.registerQueue(...)` call.

Add `PluginInitProcessor` to the `providers` array.

The final `@Module` should look like:

```typescript
@Module({
  imports: [
    BullModule.forRoot({
      connection: { url: config.REDIS_URL },
    }),
    BullModule.registerQueue(
      { name: QUEUE_EMAIL },
      { name: QUEUE_WEBHOOK },
      { name: QUEUE_VIP_MIGRATION,      defaultJobOptions: { attempts: 1 } },
      { name: QUEUE_VIP_DECOMMISSION,   defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } } },
      { name: QUEUE_DATA_EXPORT,        defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 3000 } } },
      { name: QUEUE_VIP_SHARED_CLEANUP, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 60_000 } } },
      { name: QUEUE_PLUGIN_INIT,        defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 3000 } } },
    ),
  ],
  providers: [
    EmailProcessor, WebhookRetryProcessor, VipMigrationProcessor,
    VipDecommissionProcessor, DataExportProcessor, VipSharedCleanupProcessor,
    PluginInitProcessor,
  ],
  exports: [BullModule],
})
export class BullMqModule {}
```

- [ ] **Step 6: Register in AdminModule**

Open `backend/src/api/v1/admin/admin.module.ts`.

Add `QUEUE_PLUGIN_INIT` to the `BullModule.registerQueue()` imports:

```typescript
import { QUEUE_VIP_MIGRATION, QUEUE_VIP_DECOMMISSION, QUEUE_DATA_EXPORT, QUEUE_PLUGIN_INIT } from '../../../workers/bullmq/queue.constants';
```

Add `{ name: QUEUE_PLUGIN_INIT }` to the `BullModule.registerQueue(...)` call:

```typescript
BullModule.registerQueue(
  { name: QUEUE_VIP_MIGRATION },
  { name: QUEUE_VIP_DECOMMISSION },
  { name: QUEUE_DATA_EXPORT },
  { name: QUEUE_PLUGIN_INIT },
),
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd /home/leo/Projects/VCC/crm-multi-tenant-saas-architecture/backend
npx tsc --noEmit 2>&1 | grep -E "plugin-init|bullmq.module|admin.module" | head -10
```

Expected: no errors for these files.

- [ ] **Step 8: Commit**

```bash
cd /home/leo/Projects/VCC/crm-multi-tenant-saas-architecture/backend
git add src/workers/bullmq/processors/plugin-init.processor.ts \
        src/workers/bullmq/processors/__tests__/plugin-init.processor.test.ts \
        src/workers/bullmq/bullmq.module.ts \
        src/api/v1/admin/admin.module.ts
git commit -m "feat(plugins): add PluginInitProcessor with BullMQ first-enable init job"
```

---

## Chunk 3: AdminTenantsService + Controller Update

### Task 4: Update AdminTenantsService — inject queue, add userId, init enqueue, audit log

**Files:**
- Modify: `backend/src/api/v1/admin/tenants/admin-tenants.service.ts`
- Modify: `backend/src/api/v1/admin/tenants/__tests__/admin-tenants.service.test.ts`

- [ ] **Step 1: Add mock declarations and failing tests to the test file**

In `backend/src/api/v1/admin/tenants/__tests__/admin-tenants.service.test.ts`:

**After the last `vi.hoisted()` declaration** (currently line 19: `mockGetBlockingDependents`), add:

```typescript
const mockPluginInitQueue = { add: vi.fn().mockResolvedValue(undefined) } as any;
```

Note: `mockPluginInitQueue` is NOT hoisted because it's an object literal, not a `vi.mock()` factory dependency. Declare it alongside the other queue mocks (`mockVipMigrationQueue`, etc.) at line ~66.

**After the existing imports** at the top of the file, add:

```typescript
import { PluginInitJobData } from '../../../../workers/bullmq/processors/plugin-init.processor';
```

**In the `beforeEach`** service constructor call, add `mockPluginInitQueue` as the **9th argument** (after `new (PluginDependencyService as any)()`):

```typescript
    service = new AdminTenantsService(
      new (PoolRegistry as any)(),
      new (CacheManager as any)(),
      new (AmqpPublisher as any)(),
      mockRedis,
      mockVipMigrationQueue,
      mockVipDecommissionQueue,
      mockDataExportQueue,
      new (PluginDependencyService as any)(),
      mockPluginInitQueue,  // ← add this
    );
```

**Add a new `describe('togglePlugin() — init and audit', ...)` block** at the bottom of the main `describe('AdminTenantsService', ...)`:

```typescript
  describe('togglePlugin() — init and audit', () => {
    const tenantId = 'tenant-uuid';
    const userId   = 'user-123';

    describe('first-enable init job', () => {
      it('enqueues init job and returns initializing:true when no prior row', async () => {
        mockGetMissingDeps.mockReturnValue([]);
        mockQuery
          .mockResolvedValueOnce({ rows: [] })      // SELECT: no rows
          .mockResolvedValueOnce({ rows: [] });      // INSERT

        const result = await service.togglePlugin(tenantId, 'customer-data', true, userId);

        expect(result).toEqual({ pluginId: 'customer-data', enabled: true, initializing: true });
        expect(mockPluginInitQueue.add).toHaveBeenCalledWith('init', {
          tenantId,
          pluginId: 'customer-data',
        } satisfies PluginInitJobData);
      });

      it('enqueues init job when initialized_at is null', async () => {
        mockGetMissingDeps.mockReturnValue([]);
        mockQuery
          .mockResolvedValueOnce({ rows: [{ plugin_name: 'customer-data', is_enabled: false, initialized_at: null }] })
          .mockResolvedValueOnce({ rows: [] });

        const result = await service.togglePlugin(tenantId, 'customer-data', true, userId);

        expect(result.initializing).toBe(true);
        expect(mockPluginInitQueue.add).toHaveBeenCalledOnce();
      });

      it('does NOT enqueue init job when already initialized', async () => {
        mockGetMissingDeps.mockReturnValue([]);
        mockQuery
          .mockResolvedValueOnce({ rows: [{ plugin_name: 'customer-data', is_enabled: false, initialized_at: '2026-03-10T00:00:00Z' }] })
          .mockResolvedValueOnce({ rows: [] });

        const result = await service.togglePlugin(tenantId, 'customer-data', true, userId);

        expect(result.initializing).toBe(false);
        expect(mockPluginInitQueue.add).not.toHaveBeenCalled();
      });
    });

    describe('audit log', () => {
      it('publishes plugin.enabled audit on enable', async () => {
        mockGetMissingDeps.mockReturnValue([]);
        mockQuery
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] });

        await service.togglePlugin(tenantId, 'customer-data', true, userId);

        expect(mockPublishAudit).toHaveBeenCalledWith(expect.objectContaining({
          action: 'plugin.enabled',
          resourceType: 'plugin',
          resourceId: 'customer-data',
          tenantId,
          userId,
        }));
      });

      it('publishes plugin.disabled audit on disable', async () => {
        mockGetBlockingDependents.mockReturnValue([]);
        mockQuery
          .mockResolvedValueOnce({ rows: [{ plugin_name: 'customer-data', is_enabled: true, initialized_at: '2026-03-10T00:00:00Z' }] })
          .mockResolvedValueOnce({ rows: [] });

        await service.togglePlugin(tenantId, 'customer-data', false, userId);

        expect(mockPublishAudit).toHaveBeenCalledWith(expect.objectContaining({
          action: 'plugin.disabled',
          resourceType: 'plugin',
          resourceId: 'customer-data',
          tenantId,
          userId,
        }));
      });
    });
  });
```

- [ ] **Step 2: Run failing tests**

```bash
cd /home/leo/Projects/VCC/crm-multi-tenant-saas-architecture/backend
npx vitest run src/api/v1/admin/tenants/__tests__/admin-tenants.service.test.ts \
  -t "init and audit" 2>&1 | tail -20
```

Expected: tests fail — `togglePlugin` doesn't accept `userId` yet.

- [ ] **Step 3: Update AdminTenantsService**

Open `backend/src/api/v1/admin/tenants/admin-tenants.service.ts`.

**Add imports** after the existing import block:

```typescript
import { QUEUE_PLUGIN_INIT } from '../../../../workers/bullmq/queue.constants';
import type { PluginInitJobData } from '../../../../workers/bullmq/processors/plugin-init.processor';
```

**Update the import line** for queue constants to include `QUEUE_PLUGIN_INIT` (it currently imports `QUEUE_VIP_MIGRATION, QUEUE_VIP_DECOMMISSION, QUEUE_DATA_EXPORT`):

```typescript
import { QUEUE_VIP_MIGRATION, QUEUE_VIP_DECOMMISSION, QUEUE_DATA_EXPORT, QUEUE_PLUGIN_INIT } from '../../../../workers/bullmq/queue.constants';
```

**Add to the constructor** as the 9th parameter (after `private readonly deps: PluginDependencyService`):

```typescript
    @InjectQueue(QUEUE_PLUGIN_INIT) private readonly pluginInitQueue: Queue,
```

**Replace the entire `togglePlugin` method** with:

```typescript
  async togglePlugin(
    tenantId: string,
    pluginId: string,
    enabled: boolean,
    userId: string,
  ): Promise<{ pluginId: string; enabled: boolean; initializing?: boolean }> {
    const manifest = BUILT_IN_MANIFESTS.find((m) => m.name === pluginId);
    if (!manifest) throw new NotFoundException(`Unknown plugin: ${pluginId}`);

    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      const { rows } = await client.query<{
        plugin_name: string;
        is_enabled: boolean;
        initialized_at: string | null;
      }>(
        `SELECT plugin_name, is_enabled, initialized_at FROM tenant_plugins WHERE tenant_id = $1`,
        [tenantId],
      );
      const enabledPlugins = rows.filter((r) => r.is_enabled).map((r) => r.plugin_name);

      if (enabled) {
        const missing = this.deps.getMissingDeps(pluginId, enabledPlugins);
        if (missing.length > 0) {
          throw new PluginDependencyError(pluginId, 'enable', missing, []);
        }
        await client.query(
          `INSERT INTO tenant_plugins (tenant_id, plugin_name, is_enabled)
           VALUES ($1, $2, true)
           ON CONFLICT (tenant_id, plugin_name) DO UPDATE SET is_enabled = true`,
          [tenantId, pluginId],
        );
        const targetRow = rows.find((r) => r.plugin_name === pluginId);
        const isFirstEnable = !targetRow?.initialized_at;
        if (isFirstEnable) {
          await this.pluginInitQueue.add('init', { tenantId, pluginId } satisfies PluginInitJobData);
        }
        await this.amqp.publishAudit({
          tenantId,
          userId,
          action: 'plugin.enabled',
          resourceType: 'plugin',
          resourceId: pluginId,
          payload: { pluginId, initializing: isFirstEnable },
          timestamp: new Date().toISOString(),
        });
        await this.cache.delForTenant(tenantId, 'tenant-config', 'enabled-plugins');
        return { pluginId, enabled: true, initializing: isFirstEnable };
      } else {
        const blocking = this.deps.getBlockingDependents(pluginId, enabledPlugins);
        if (blocking.length > 0) {
          throw new PluginDependencyError(pluginId, 'disable', [], blocking);
        }
        await client.query(
          `INSERT INTO tenant_plugins (tenant_id, plugin_name, is_enabled)
           VALUES ($1, $2, false)
           ON CONFLICT (tenant_id, plugin_name) DO UPDATE SET is_enabled = false`,
          [tenantId, pluginId],
        );
        await this.amqp.publishAudit({
          tenantId,
          userId,
          action: 'plugin.disabled',
          resourceType: 'plugin',
          resourceId: pluginId,
          payload: { pluginId },
          timestamp: new Date().toISOString(),
        });
        await this.cache.delForTenant(tenantId, 'tenant-config', 'enabled-plugins');
        return { pluginId, enabled: false };
      }
    } finally {
      client.release();
    }
  }
```

- [ ] **Step 4: Run init+audit tests — confirm PASS**

```bash
cd /home/leo/Projects/VCC/crm-multi-tenant-saas-architecture/backend
npx vitest run src/api/v1/admin/tenants/__tests__/admin-tenants.service.test.ts \
  -t "init and audit" 2>&1 | tail -15
```

Expected: all 5 new tests pass.

- [ ] **Step 5: Update the existing 5 `togglePlugin()` call sites in the old describe block**

The old `describe('togglePlugin()', ...)` block declares `const tenantId = 'tenant-uuid'`. Add `const userId = 'user-123';` alongside it.

Replace the 5 existing `service.togglePlugin(...)` calls as follows:

```typescript
// OLD → NEW for each call:

// 1. enable success test — also add initialized_at to mock row and update toEqual
mockQuery
  .mockResolvedValueOnce({ rows: [{ plugin_name: 'customer-data', is_enabled: true, initialized_at: null }] })
  .mockResolvedValueOnce({ rows: [] });
const result = await service.togglePlugin(tenantId, 'customer-care', true, userId);
expect(result).toEqual({ pluginId: 'customer-care', enabled: true, initializing: true });

// 2. enable 422 test
await expect(service.togglePlugin(tenantId, 'customer-care', true, userId))
  .rejects.toMatchObject({ ... });

// 3. disable success test — toEqual unchanged (disable has no initializing field)
const result = await service.togglePlugin(tenantId, 'analytics', false, userId);
expect(result).toEqual({ pluginId: 'analytics', enabled: false });

// 4. disable 422 test
await expect(service.togglePlugin(tenantId, 'customer-data', false, userId))
  .rejects.toMatchObject({ ... });

// 5. cascade test
await expect(service.togglePlugin(tenantId, 'customer-data', false, userId)).rejects.toThrow();
```

Key note for test 1: the SELECT row now needs `initialized_at` — without it, `targetRow` for `'customer-care'` would be `undefined` (since the SELECT returns a `'customer-data'` row), so `isFirstEnable = true` and `mockPluginInitQueue.add` is called. Since `mockPluginInitQueue` is mocked, this is fine — just update `toEqual` to include `initializing: true`.

- [ ] **Step 6: Run full togglePlugin test suite**

```bash
cd /home/leo/Projects/VCC/crm-multi-tenant-saas-architecture/backend
npx vitest run src/api/v1/admin/tenants/__tests__/admin-tenants.service.test.ts \
  -t "togglePlugin" 2>&1 | tail -20
```

Expected: all 10 togglePlugin tests pass (5 existing + 5 new).

### Task 5: Update AdminTenantsController + run full suite

**Files:**
- Modify: `backend/src/api/v1/admin/tenants/admin-tenants.controller.ts`

- [ ] **Step 1: Update the controller**

Open `backend/src/api/v1/admin/tenants/admin-tenants.controller.ts`.

Add imports at the top (check what's already imported — add only what's missing):

```typescript
import { CurrentUser } from '../../../../gateway/decorators/current-tenant.decorator';
import type { JwtClaims } from '../../../../gateway/dto/jwt-claims.dto';
```

Replace the `togglePlugin` handler:

```typescript
  @Patch(':tenantId/plugins/:pluginId')
  togglePlugin(
    @Param('tenantId') tenantId: string,
    @Param('pluginId') pluginId: string,
    @Body() body: { enabled: boolean },
    @CurrentUser() user: JwtClaims,
  ) {
    return this.tenantsService.togglePlugin(tenantId, pluginId, body.enabled, user.sub);
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/leo/Projects/VCC/crm-multi-tenant-saas-architecture/backend
npx tsc --noEmit 2>&1 | grep -E "admin-tenants" | head -10
```

Expected: no errors.

- [ ] **Step 3: Run full test suite**

```bash
cd /home/leo/Projects/VCC/crm-multi-tenant-saas-architecture/backend
npm test 2>&1 | tail -15
```

Expected: all tests pass. The 2 pre-existing failures (`QueryInterceptor.test.ts`, `jwt-auth.test.ts`) are expected and unrelated.

- [ ] **Step 4: Commit**

```bash
cd /home/leo/Projects/VCC/crm-multi-tenant-saas-architecture/backend
git add src/api/v1/admin/tenants/admin-tenants.service.ts \
        src/api/v1/admin/tenants/admin-tenants.controller.ts \
        src/api/v1/admin/tenants/__tests__/admin-tenants.service.test.ts
git commit -m "feat(plugins): add first-enable init job, userId param, and audit log to togglePlugin"
```

---

## Final Verification

- [ ] **Run full test suite one last time**

```bash
cd /home/leo/Projects/VCC/crm-multi-tenant-saas-architecture/backend
npm test 2>&1 | tail -10
```

Expected: all tests pass (plus 2 pre-existing failures).

- [ ] **TypeScript clean compile**

```bash
cd /home/leo/Projects/VCC/crm-multi-tenant-saas-architecture/backend
npx tsc --noEmit 2>&1 | grep -v "node_modules" | head -20
```

Expected: no new errors introduced by this feature.
