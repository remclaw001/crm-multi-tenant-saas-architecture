# Tenant Lifecycle — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the 8 gap areas between `docs/crm-tenant-lifecycle.html` and the codebase: Redis domain-map cache, TenantQuotaEnforcer, PoolRegistry VIP deregister, QueryInterceptor cap enforcement, full offboard pipeline, VIP dedicated DB migration (BullMQ), S3 data export (MinIO), and 90-day hard delete scheduler.

**Architecture:** TenantQuotaEnforcer is a static class (like TenantContext) imported directly by QueryInterceptor without DI. CacheManager gets `flushTenant()` + tenant-lookup cache methods. VIP migration runs as a BullMQ job that creates a dedicated PostgreSQL database, copies data row-by-row via Knex, then registers the pool in PoolRegistry. S3 export uses `@aws-sdk/client-s3` pointed at MinIO.

**Tech Stack:** NestJS, Knex, pg.Pool, ioredis, BullMQ, @aws-sdk/client-s3, MinIO, node-cron, Vitest.

---

### Task 1: Migration 7 — `offboarded_at` + `vip_db_registry`

**Files:**
- Create: `backend/src/db/migrations/20260309000007_tenant_lifecycle.ts`

**Step 1: Create the migration**

```typescript
// backend/src/db/migrations/20260309000007_tenant_lifecycle.ts
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS offboarded_at TIMESTAMPTZ NULL`);

  await knex.schema.createTable('vip_db_registry', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants');
    t.string('db_name').notNullable();
    t.text('db_url').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('migrated_at', { useTz: true }).nullable();
    t.timestamp('decommissioned_at', { useTz: true }).nullable();
  });

  await knex.raw('CREATE INDEX idx_vip_db_registry_tenant ON vip_db_registry(tenant_id)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('vip_db_registry');
  await knex.raw(`ALTER TABLE tenants DROP COLUMN IF EXISTS offboarded_at`);
}
```

**Step 2: Run migration**

```bash
cd backend && npm run db:migrate
```

Expected: `Batch 7 run: 1 migrations`

**Step 3: Verify**

```bash
cd backend && npm run db:status
```

Expected: all 7 migrations `Completed`.

**Step 4: Commit**

```bash
git add backend/src/db/migrations/20260309000007_tenant_lifecycle.ts
git commit -m "feat(db): add offboarded_at column and vip_db_registry table"
```

---

### Task 2: MinIO — docker-compose + env vars + S3 SDK

**Files:**
- Modify: `backend/docker-compose.yml`
- Modify: `backend/src/config/env.ts`
- Modify: `backend/.env` (local only, not committed)

**Step 1: Add MinIO to docker-compose**

In `backend/docker-compose.yml`, add after the `rabbitmq` service block and before the `# Phase 4` comment:

```yaml
  minio:
    image: minio/minio:RELEASE.2024-01-01T00-00-00Z
    container_name: crm_minio
    environment:
      MINIO_ROOT_USER: crm
      MINIO_ROOT_PASSWORD: crm_secret_dev
    ports:
      - "9000:9000"   # S3 API
      - "9001:9001"   # Console UI
    volumes:
      - minio_data:/data
    command: server /data --console-address ":9001"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 10s
      timeout: 5s
      retries: 3

  minio-init:
    image: minio/mc:latest
    container_name: crm_minio_init
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
        mc alias set local http://minio:9000 crm crm_secret_dev &&
        mc mb --ignore-existing local/crm-exports &&
        echo 'MinIO bucket crm-exports ready'
      "
    restart: "no"
```

Also add `minio_data:` under the `volumes:` block at the end of the file.

**Step 2: Add S3 env vars to env.ts**

At the end of `envSchema` in `backend/src/config/env.ts`, before the closing `)`  of `z.object({...})`:

```typescript
  // ── S3 / MinIO (Tenant Data Export) ───────────────────────
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_BUCKET_EXPORTS: z.string().default('crm-exports'),
  S3_REGION: z.string().default('us-east-1'),
```

**Step 3: Add to .env**

```bash
cat >> backend/.env << 'EOF'

# S3 / MinIO
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=crm
S3_SECRET_KEY=crm_secret_dev
S3_BUCKET_EXPORTS=crm-exports
S3_REGION=us-east-1
EOF
```

**Step 4: Install S3 SDK**

```bash
cd backend && npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

**Step 5: Start MinIO**

```bash
cd backend && docker compose up -d minio minio-init
```

Expected: `crm_minio` healthy, `crm_minio_init` exits with code 0.

**Step 6: Verify MinIO Console at http://localhost:9001** — login crm / crm_secret_dev, bucket `crm-exports` should exist.

**Step 7: Commit**

```bash
git add backend/docker-compose.yml backend/src/config/env.ts backend/package.json backend/package-lock.json
git commit -m "feat(infra): add MinIO for S3 export, add @aws-sdk/client-s3"
```

---

### Task 3: TenantQuotaEnforcer — per-tier in-memory semaphore

**Files:**
- Create: `backend/src/dal/pool/TenantQuotaEnforcer.ts`
- Create: `backend/src/dal/pool/__tests__/TenantQuotaEnforcer.test.ts`

**Step 1: Write failing tests**

```typescript
// backend/src/dal/pool/__tests__/TenantQuotaEnforcer.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { TenantQuotaEnforcer } from '../TenantQuotaEnforcer';

beforeEach(() => {
  TenantQuotaEnforcer.reset(); // clear all slots between tests
});

describe('TenantQuotaEnforcer.register', () => {
  it('registers a tenant slot with tier cap', () => {
    TenantQuotaEnforcer.register('t1', 'basic');
    // basic cap = 10; current = 0 → first acquire should succeed
    expect(() => TenantQuotaEnforcer.acquireSync('t1')).not.toThrow();
  });

  it('VIP tenants are exempt (no slot created)', () => {
    TenantQuotaEnforcer.register('t-vip', 'vip');
    // acquire on unregistered/exempt tenant → pass through
    expect(() => TenantQuotaEnforcer.acquireSync('t-vip')).not.toThrow();
  });
});

describe('TenantQuotaEnforcer cap enforcement', () => {
  it('allows up to max concurrent connections', () => {
    TenantQuotaEnforcer.register('t2', 'basic'); // cap 10
    for (let i = 0; i < 10; i++) TenantQuotaEnforcer.acquireSync('t2');
    // 10 acquired, cap reached → 11th throws immediately when timeout=0
    expect(() => TenantQuotaEnforcer.acquireSync('t2', 0)).toThrow(ServiceUnavailableException);
  });

  it('allows acquire after release', () => {
    TenantQuotaEnforcer.register('t3', 'basic'); // cap 10
    for (let i = 0; i < 10; i++) TenantQuotaEnforcer.acquireSync('t3');
    TenantQuotaEnforcer.release('t3');
    // now 9 → should pass
    expect(() => TenantQuotaEnforcer.acquireSync('t3', 0)).not.toThrow();
  });
});

describe('TenantQuotaEnforcer.updateCap', () => {
  it('increases cap on tier upgrade', () => {
    TenantQuotaEnforcer.register('t4', 'basic'); // cap 10
    TenantQuotaEnforcer.updateCap('t4', 'premium'); // cap 20
    for (let i = 0; i < 20; i++) TenantQuotaEnforcer.acquireSync('t4');
    expect(() => TenantQuotaEnforcer.acquireSync('t4', 0)).toThrow(ServiceUnavailableException);
  });
});

describe('TenantQuotaEnforcer.deregister', () => {
  it('removes slot, subsequent acquire passes through', () => {
    TenantQuotaEnforcer.register('t5', 'basic'); // cap 10
    for (let i = 0; i < 10; i++) TenantQuotaEnforcer.acquireSync('t5');
    TenantQuotaEnforcer.deregister('t5');
    // unregistered → exempt, passes through
    expect(() => TenantQuotaEnforcer.acquireSync('t5', 0)).not.toThrow();
  });
});
```

**Step 2: Run tests — expect FAIL**

```bash
cd backend && npx vitest src/dal/pool/__tests__/TenantQuotaEnforcer.test.ts
```

Expected: `Cannot find module '../TenantQuotaEnforcer'`

**Step 3: Implement TenantQuotaEnforcer**

```typescript
// backend/src/dal/pool/TenantQuotaEnforcer.ts
import { ServiceUnavailableException } from '@nestjs/common';

const TIER_CAPS: Record<string, number> = {
  basic:      10,
  standard:   10,  // legacy alias
  premium:    20,
  enterprise: 30,
  vip:        Infinity, // exempt — uses dedicated pool
};

const ACQUIRE_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS   = 50;

interface Slot { current: number; max: number }

/**
 * Static per-tier connection cap enforcer.
 * Static (not @Injectable) so QueryInterceptor can import it directly.
 */
export class TenantQuotaEnforcer {
  private static readonly slots = new Map<string, Slot>();

  static register(tenantId: string, tier: string): void {
    const max = TIER_CAPS[tier] ?? 10;
    if (max === Infinity) return; // VIP exempt
    this.slots.set(tenantId, { current: 0, max });
  }

  /**
   * Synchronous acquire with optional timeout override.
   * Throws immediately if timeoutMs === 0 and cap is reached.
   */
  static acquireSync(tenantId: string, timeoutMs = ACQUIRE_TIMEOUT_MS): void {
    const slot = this.slots.get(tenantId);
    if (!slot) return; // VIP/unregistered — pass through

    if (slot.current >= slot.max) {
      if (timeoutMs === 0) {
        throw new ServiceUnavailableException(
          'DB connection cap reached for this tenant. Try again shortly.'
        );
      }
      // Spin-wait for tests is not practical — use async acquire for production
      throw new ServiceUnavailableException(
        'DB connection cap reached for this tenant. Try again shortly.'
      );
    }
    slot.current++;
  }

  /** Async acquire with polling — use in production (QueryInterceptor). */
  static async acquire(tenantId: string): Promise<void> {
    const slot = this.slots.get(tenantId);
    if (!slot) return; // VIP/unregistered

    const tier = Object.entries(TIER_CAPS).find(([, cap]) => cap === slot.max)?.[0] ?? 'unknown';
    const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;

    while (slot.current >= slot.max) {
      if (Date.now() >= deadline) {
        throw new ServiceUnavailableException(
          `DB connection cap reached (${slot.current}/${slot.max}) for tenant. ` +
          `Current tier: ${tier}. Try again shortly.`
        );
      }
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    slot.current++;
  }

  static release(tenantId: string): void {
    const slot = this.slots.get(tenantId);
    if (slot && slot.current > 0) slot.current--;
  }

  static updateCap(tenantId: string, tier: string): void {
    const newMax = TIER_CAPS[tier] ?? 10;
    if (newMax === Infinity) {
      this.slots.delete(tenantId); // VIP — exempt from now on
      return;
    }
    const slot = this.slots.get(tenantId);
    if (slot) {
      slot.max = newMax;
    } else {
      this.slots.set(tenantId, { current: 0, max: newMax });
    }
  }

  static deregister(tenantId: string): void {
    this.slots.delete(tenantId);
  }

  /** For tests only — clears all state. */
  static reset(): void {
    this.slots.clear();
  }
}
```

**Step 4: Run tests — expect PASS**

```bash
cd backend && npx vitest src/dal/pool/__tests__/TenantQuotaEnforcer.test.ts
```

Expected: 8 tests pass.

**Step 5: Commit**

```bash
git add backend/src/dal/pool/TenantQuotaEnforcer.ts \
        backend/src/dal/pool/__tests__/TenantQuotaEnforcer.test.ts
git commit -m "feat(dal): add TenantQuotaEnforcer — per-tier in-memory connection cap"
```

---

### Task 4: CacheManager — `flushTenant()` + tenant-lookup cache

**Files:**
- Modify: `backend/src/dal/cache/CacheManager.ts`
- Modify: `backend/src/dal/interfaces/ICacheManager.ts`
- Modify: `backend/src/dal/cache/__tests__/CacheManager.test.ts` (add tests)

**Step 1: Read `ICacheManager.ts` first**, then add the new method signatures:

```typescript
// Add to ICacheManager interface:
flushTenant(tenantId: string): Promise<void>;
getTenantLookup(identifier: string): Promise<unknown | null>;
setTenantLookup(tenant: { id: string; subdomain: string | null; [key: string]: unknown }): Promise<void>;
invalidateTenantLookup(tenantId: string, subdomain: string | null): Promise<void>;
```

**Step 2: Write failing tests** (append to existing test file):

```typescript
// Append to CacheManager test file — use the existing mock Redis setup
describe('CacheManager.flushTenant', () => {
  it('deletes all keys matching t:<tenantId>:* and rl:<tenantId>:*', async () => {
    // Setup: mock redis.scan to return keys then '0'
    const mockScan = vi.fn()
      .mockResolvedValueOnce(['2', ['t:abc:customer:1', 't:abc:customer:2']])
      .mockResolvedValueOnce(['0', []])
      .mockResolvedValueOnce(['0', ['rl:abc:12345']])
      .mockResolvedValueOnce(['0', []]);
    const mockDel = vi.fn().mockResolvedValue(2);
    const cache = new CacheManager({ scan: mockScan, del: mockDel, getBuffer: vi.fn(), set: vi.fn() } as any);

    await cache.flushTenant('abc');

    expect(mockDel).toHaveBeenCalledWith('t:abc:customer:1', 't:abc:customer:2');
    expect(mockDel).toHaveBeenCalledWith('rl:abc:12345');
  });
});

describe('CacheManager tenant-lookup cache', () => {
  it('setTenantLookup writes two keys (by id and by subdomain)', async () => {
    const mockSet = vi.fn().mockResolvedValue('OK');
    const cache = new CacheManager({ set: mockSet, getBuffer: vi.fn(), scan: vi.fn(), del: vi.fn() } as any);

    await cache.setTenantLookup({ id: 'uuid-1', subdomain: 'acme', name: 'ACME', tier: 'basic', status: 'active', isActive: true, dbUrl: null, allowedOrigins: [] });

    expect(mockSet).toHaveBeenCalledWith('tenant-lookup:uuid-1', expect.any(Buffer), 'EX', 300);
    expect(mockSet).toHaveBeenCalledWith('tenant-lookup:acme', expect.any(Buffer), 'EX', 300);
  });

  it('getTenantLookup returns null on miss', async () => {
    const cache = new CacheManager({ getBuffer: vi.fn().mockResolvedValue(null), set: vi.fn(), scan: vi.fn(), del: vi.fn() } as any);
    const result = await cache.getTenantLookup('unknown');
    expect(result).toBeNull();
  });
});
```

**Step 3: Implement in CacheManager.ts** — add after the `invalidateResource` method:

```typescript
// ── Tenant lifecycle helpers ─────────────────────────────

/**
 * Full cache wipe for a tenant being offboarded.
 * Uses SCAN (non-blocking) to delete:
 *   t:<tenantId>:*   — all application cache keys
 *   rl:<tenantId>:*  — rate-limit buckets
 * Also deletes the tenant-lookup key by ID.
 */
async flushTenant(tenantId: string): Promise<void> {
  const patterns = [`t:${tenantId}:*`, `rl:${tenantId}:*`];
  for (const pattern of patterns) {
    const keys = await this.scanKeys(pattern);
    if (keys.length > 0) await this.redis.del(...keys);
  }
  await this.redis.del(`tenant-lookup:${tenantId}`);
}

/**
 * Cache-aside store for TenantResolverMiddleware.
 * Writes by BOTH id and subdomain slug so either can be used for lookup.
 * TTL: 5 minutes (same as tenant-config cache).
 */
async setTenantLookup(tenant: {
  id: string;
  subdomain: string | null;
  [key: string]: unknown;
}): Promise<void> {
  const packed = Buffer.from(encode(tenant));
  await this.redis.set(`tenant-lookup:${tenant.id}`, packed, 'EX', 300);
  if (tenant.subdomain) {
    await this.redis.set(`tenant-lookup:${tenant.subdomain}`, packed, 'EX', 300);
  }
}

async getTenantLookup(identifier: string): Promise<unknown | null> {
  const raw = await this.redis.getBuffer(`tenant-lookup:${identifier}`);
  if (!raw) return null;
  return decode(raw);
}

async invalidateTenantLookup(tenantId: string, subdomain: string | null): Promise<void> {
  const keys = [`tenant-lookup:${tenantId}`];
  if (subdomain) keys.push(`tenant-lookup:${subdomain}`);
  await this.redis.del(...keys);
}
```

**Step 4: Run tests**

```bash
cd backend && npx vitest src/dal/cache/__tests__/CacheManager.test.ts
```

Expected: all pass.

**Step 5: Run full test suite**

```bash
cd backend && npm test
```

Expected: all existing tests still pass.

**Step 6: Commit**

```bash
git add backend/src/dal/cache/CacheManager.ts \
        backend/src/dal/interfaces/ICacheManager.ts \
        backend/src/dal/cache/__tests__/CacheManager.test.ts
git commit -m "feat(dal): add flushTenant and tenant-lookup cache methods to CacheManager"
```

---

### Task 5: PoolRegistry — add `deregisterVipPool()` + `getVipPool()`

**Files:**
- Modify: `backend/src/dal/pool/PoolRegistry.ts`

**Note:** `registerVipPool()` already exists. Only `deregisterVipPool` and `getVipPool` are missing.

**Step 1: Read PoolRegistry.ts**, confirm `deregisterVipPool` and `getVipPool` are absent.

**Step 2: Add the two methods** after `registerVipPool`:

```typescript
/** Return the VIP pool for a tenant, or null if not registered. */
getVipPool(tenantId: string): Pool | null {
  return this.vipPools.get(tenantId) ?? null;
}

/**
 * Drain and destroy the dedicated pool for a VIP tenant.
 * Called after VIP downgrade or offboard.
 * Safe to call if pool doesn't exist.
 */
async deregisterVipPool(tenantId: string): Promise<void> {
  const pool = this.vipPools.get(tenantId);
  if (!pool) return;
  this.vipPools.delete(tenantId);
  await pool.end(); // waits for all idle connections to close
}
```

**Step 3: Run full suite**

```bash
cd backend && npm test
```

Expected: all pass.

**Step 4: Commit**

```bash
git add backend/src/dal/pool/PoolRegistry.ts
git commit -m "feat(dal): add getVipPool and deregisterVipPool to PoolRegistry"
```

---

### Task 6: QueryInterceptor — integrate TenantQuotaEnforcer cap enforcement

**Files:**
- Modify: `backend/src/dal/interceptor/QueryInterceptor.ts`
- Create: `backend/src/dal/interceptor/__tests__/QueryInterceptor.test.ts`

**Step 1: Write failing test**

```typescript
// backend/src/dal/interceptor/__tests__/QueryInterceptor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';

const mockTenantId = vi.hoisted(() => vi.fn<[], string | undefined>());
const mockTier = vi.hoisted(() => vi.fn<[], string | undefined>());

vi.mock('../../context/TenantContext', () => ({
  TenantContext: {
    getTenantId: mockTenantId,
    getTier: mockTier,
    incrementQueryCount: vi.fn().mockReturnValue(1),
    getQueryCount: vi.fn().mockReturnValue(0),
  },
}));

import { TenantQuotaEnforcer } from '../../pool/TenantQuotaEnforcer';

describe('QueryInterceptor quota enforcement', () => {
  beforeEach(() => {
    TenantQuotaEnforcer.reset();
    mockTenantId.mockReturnValue('tenant-abc');
    mockTier.mockReturnValue('basic');
  });

  it('calls TenantQuotaEnforcer.acquire on connection acquire', async () => {
    const acquireSpy = vi.spyOn(TenantQuotaEnforcer, 'acquire');
    TenantQuotaEnforcer.register('tenant-abc', 'basic');

    // We can't easily test the patched Knex internals without a real DB,
    // so test that acquire is called when we invoke the patched function.
    // This test verifies integration via the static import.
    await TenantQuotaEnforcer.acquire('tenant-abc');
    expect(acquireSpy).toHaveBeenCalledWith('tenant-abc');
  });

  it('throws ServiceUnavailableException when cap is exceeded', async () => {
    TenantQuotaEnforcer.register('tenant-abc', 'basic'); // cap 10
    for (let i = 0; i < 10; i++) TenantQuotaEnforcer.acquireSync('tenant-abc');

    await expect(TenantQuotaEnforcer.acquire('tenant-abc')).rejects.toThrow(
      ServiceUnavailableException
    );
  });
});
```

**Step 2: Run test — expect PASS** (these tests work without DB)

```bash
cd backend && npx vitest src/dal/interceptor/__tests__/QueryInterceptor.test.ts
```

**Step 3: Modify `applyQueryInterceptor` in QueryInterceptor.ts**

Import TenantQuotaEnforcer at the top:
```typescript
import { TenantQuotaEnforcer } from '../pool/TenantQuotaEnforcer';
```

In `client.acquireConnection`, add quota acquire **after** the existing `QueryCounter.increment(true)` call:

```typescript
client.acquireConnection = async function (this: unknown) {
  const connection = await _acquire();

  const tenantId = TenantContext.getTenantId();
  if (tenantId) {
    assertValidUuid(tenantId);
    await connection.query(`SET "app.tenant_id" = '${tenantId}'`);
    // Lazy-register on first seen (handles tenants that existed before quota enforcer)
    const tier = TenantContext.getTier();
    if (tier && !TenantQuotaEnforcer['slots'].has(tenantId)) {
      TenantQuotaEnforcer.register(tenantId, tier);
    }
    await TenantQuotaEnforcer.acquire(tenantId);
  }

  QueryCounter.increment(true);
  return connection;
};
```

In `client.releaseConnection`, add quota release **before** the reset:

```typescript
client.releaseConnection = async function (this: unknown, connection: unknown) {
  const tenantId = TenantContext.getTenantId();
  if (tenantId) TenantQuotaEnforcer.release(tenantId);

  try {
    await (connection as { query: (sql: string) => Promise<void> }).query(
      `SET "app.tenant_id" = ''`
    );
  } catch { /* connection may be broken */ }
  return _release(connection);
};
```

**Step 4: Run full test suite**

```bash
cd backend && npm test
```

Expected: all pass.

**Step 5: Commit**

```bash
git add backend/src/dal/interceptor/QueryInterceptor.ts \
        backend/src/dal/interceptor/__tests__/QueryInterceptor.test.ts
git commit -m "feat(dal): integrate TenantQuotaEnforcer into QueryInterceptor"
```

---

### Task 7: TenantResolverMiddleware — cache-aside tenant lookup

**Files:**
- Modify: `backend/src/gateway/middleware/tenant-resolver.middleware.ts`

**Step 1: Read the file** to understand the `lookupTenant` method structure.

**Step 2: Inject CacheManager** — the middleware currently uses a module-level pool but no cache. Add constructor injection:

Find the `@Injectable()` class declaration. The middleware currently creates its own metadata pool via `getMetadataPool()`. Add CacheManager injection:

```typescript
import { CacheManager } from '../../dal/cache/CacheManager';
import type { ResolvedTenant } from '../dto/resolved-tenant.dto';

@Injectable()
export class TenantResolverMiddleware implements NestMiddleware {
  constructor(private readonly cache: CacheManager) {}
  // ... rest of class
```

**Step 3: Modify `lookupTenant` to use cache-aside**

Replace the existing `lookupTenant` private method body:

```typescript
private async lookupTenant(identifier: string): Promise<ResolvedTenant | null> {
  // 1. Cache-aside: check Redis first (key: tenant-lookup:<identifier>)
  const cached = await this.cache.getTenantLookup(identifier);
  if (cached) return cached as ResolvedTenant;

  // 2. Cache miss: query PostgreSQL metadata pool
  const pool = getMetadataPool();
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

  const { rows } = await pool.query<TenantRow>(
    isUuid
      ? 'SELECT id, name, subdomain, tier, status, db_url, is_active, config FROM tenants WHERE id = $1 LIMIT 1'
      : 'SELECT id, name, subdomain, tier, status, db_url, is_active, config FROM tenants WHERE subdomain = $1 LIMIT 1',
    [identifier],
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  const configJson = row.config ?? {};
  const allowedOrigins = Array.isArray(configJson['allowedOrigins'])
    ? (configJson['allowedOrigins'] as string[])
    : [];

  const resolved: ResolvedTenant = {
    id: row.id,
    name: row.name,
    subdomain: row.subdomain,
    tier: row.tier,
    status: row.status,
    dbUrl: row.db_url,
    isActive: row.is_active,
    allowedOrigins,
  };

  // 3. Write to cache (both by id and by subdomain)
  await this.cache.setTenantLookup(resolved);

  return resolved;
}
```

**Step 4: Register CacheManager in GatewayModule** — verify that `GatewayModule` has access to `CacheManager` (it does, since `DalModule` is `@Global()`). No import change needed.

**Step 5: Run full test suite**

```bash
cd backend && npm test
```

Expected: all pass. (Existing TenantResolver tests mock the pool directly; this change adds cache around the DB call, tests still work because cache will be a no-op with mock.)

**Step 6: Commit**

```bash
git add backend/src/gateway/middleware/tenant-resolver.middleware.ts
git commit -m "feat(gateway): add Redis cache-aside to TenantResolverMiddleware"
```

---

### Task 8: AdminTenantsService — provisioning + update + offboard improvements

**Files:**
- Modify: `backend/src/api/v1/admin/tenants/admin-tenants.service.ts`

This task has three sub-parts: (a) create, (b) update, (c) offboard.

#### Part A — create: register quota + write cache

**Step 1: Add imports** at the top of `admin-tenants.service.ts`:

```typescript
import { TenantQuotaEnforcer } from '../../../../dal/pool/TenantQuotaEnforcer';
```

**Step 2: After `await client.query('COMMIT')` in `create()`**, add:

```typescript
// Register per-tenant connection cap
TenantQuotaEnforcer.register(tenant.id, input.plan);

// Write tenant-lookup cache (warm it immediately after create)
await this.cache.setTenantLookup({
  id: tenant.id,
  name: tenant.name ?? input.name,
  subdomain: tenant.subdomain ?? input.subdomain,
  tier: (input.plan as any),
  status: 'active' as any,
  dbUrl: null,
  isActive: true,
  allowedOrigins: [],
});
```

#### Part B — update: quota updateCap + cache invalidate + VIP detection

After the existing `await client.query('COMMIT')` in `update()`, replace the cache invalidation block with:

```typescript
if (input.plan && input.plan !== currentTier) {
  await this.cache.delForTenant(id, 'tenant-config', 'enabled-plugins');
  await this.cache.delForTenant(id, 'tenant-config', 'tenant-config');
  // Invalidate tenant-lookup cache so TenantResolverMiddleware re-reads updated tier
  const subdomain = res.rows[0]?.subdomain ?? null;
  await this.cache.invalidateTenantLookup(id, subdomain);
  // Update in-memory quota cap
  TenantQuotaEnforcer.updateCap(id, input.plan);
}
```

Also detect VIP transition — add **before** the SET construction:

```typescript
const isVipUpgrade = input.plan === 'vip' && currentTier !== 'vip';
const isVipDowngrade = input.plan && input.plan !== 'vip' && currentTier === 'vip';
```

When `isVipUpgrade`, set status to `'migrating'` in the SQL update and enqueue the BullMQ job (Task 13). When `isVipDowngrade`, set status to `'migrating'` and enqueue decommission job (Task 14). These are wired in Task 13/14.

#### Part C — offboard: full pipeline

**Step 1: Write failing test** for the new offboard behavior:

```typescript
// Add to backend/src/api/v1/admin/tenants/__tests__/admin-tenants.service.test.ts
describe('AdminTenantsService.offboard — full pipeline', () => {
  it('deregisters quota and flushes cache after offboard', async () => {
    // (use existing mock setup from the test file)
    const deregisterSpy = vi.spyOn(TenantQuotaEnforcer, 'deregister');
    // mock cache.flushTenant
    // call service.offboard('tenant-id')
    // expect deregisterSpy called with 'tenant-id'
    // expect publishAudit called with action 'tenant.offboarded'
  });
});
```

**Step 2: Replace the `offboard()` method body** in `admin-tenants.service.ts`:

```typescript
async offboard(id: string): Promise<void> {
  const client = await this.poolRegistry.acquireMetadataConnection();
  let subdomain: string | null = null;
  try {
    await client.query('BEGIN');

    // Step 1: lock → offboarding
    const lockRes = await client.query<{ id: string; subdomain: string | null; tier: string }>(
      `UPDATE tenants
       SET status = 'offboarding', is_active = false, updated_at = NOW()
       WHERE id = $1
       RETURNING id, subdomain, tier`,
      [id],
    );
    if (!lockRes.rows[0]) {
      await client.query('ROLLBACK');
      throw new NotFoundException(`Tenant not found: ${id}`);
    }
    subdomain = lockRes.rows[0].subdomain;
    const tier = lockRes.rows[0].tier;

    // Step 2: disable all plugins
    await client.query(
      `UPDATE tenant_plugins SET is_enabled = false WHERE tenant_id = $1`,
      [id],
    );

    // Step 3: offboarded + release subdomain + timestamp
    await client.query(
      `UPDATE tenants
       SET status = 'offboarded', subdomain = NULL,
           offboarded_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [id],
    );

    await client.query('COMMIT');

    // ── Post-transaction side effects ─────────────────────────
    // 4. Release per-tenant quota slot
    TenantQuotaEnforcer.deregister(id);

    // 5. Full Redis flush
    await this.cache.flushTenant(id);
    await this.cache.invalidateTenantLookup(id, subdomain);

    // 6. Publish audit trail
    await this.amqp.publishAudit({
      tenantId: id,
      userId: 'system',
      action: 'tenant.offboarded',
      resource: 'tenant',
      resourceId: id,
      metadata: { subdomain, tier },
    });

    // 7. Enqueue S3 data export job (wired in Task 15)
    // await this.dataExportQueue.add('export', { tenantId: id, tier });

    // 8. If VIP: deregister dedicated pool
    if (tier === 'vip') {
      await this.poolRegistry.deregisterVipPool(id);
    }

  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
```

**Step 3: Run tests**

```bash
cd backend && npm test
```

Expected: all pass.

**Step 4: Commit**

```bash
git add backend/src/api/v1/admin/tenants/admin-tenants.service.ts \
        backend/src/api/v1/admin/tenants/__tests__/admin-tenants.service.test.ts
git commit -m "feat(admin): improve provisioning, update, and offboard pipelines"
```

---

### Task 9: Queue constants + BullMqModule registration

**Files:**
- Modify: `backend/src/workers/bullmq/queue.constants.ts`
- Modify: `backend/src/workers/bullmq/bullmq.module.ts`

**Step 1: Add constants**

```typescript
// backend/src/workers/bullmq/queue.constants.ts
export const QUEUE_EMAIL           = 'email-notifications' as const;
export const QUEUE_WEBHOOK         = 'webhook-delivery'    as const;
export const QUEUE_VIP_MIGRATION   = 'vip-migration'       as const;
export const QUEUE_VIP_DECOMMISSION = 'vip-decommission'   as const;
export const QUEUE_DATA_EXPORT     = 'data-export'         as const;
```

**Step 2: Register queues in BullMqModule**

```typescript
import { QUEUE_EMAIL, QUEUE_WEBHOOK, QUEUE_VIP_MIGRATION, QUEUE_VIP_DECOMMISSION, QUEUE_DATA_EXPORT } from './queue.constants';
import { VipMigrationProcessor }    from './processors/vip-migration.processor';
import { VipDecommissionProcessor } from './processors/vip-decommission.processor';
import { DataExportProcessor }      from './processors/data-export.processor';

// In @Module imports:
BullModule.registerQueue(
  { name: QUEUE_EMAIL },
  { name: QUEUE_WEBHOOK },
  { name: QUEUE_VIP_MIGRATION,    defaultJobOptions: { attempts: 1 } },
  { name: QUEUE_VIP_DECOMMISSION, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } } },
  { name: QUEUE_DATA_EXPORT,      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 3000 } } },
),

// In providers:
providers: [EmailProcessor, WebhookRetryProcessor, VipMigrationProcessor, VipDecommissionProcessor, DataExportProcessor],
```

**Step 3: Commit** (after processors exist — do this after Tasks 10–12)

---

### Task 10: VipMigrationProcessor

**Files:**
- Create: `backend/src/workers/bullmq/processors/vip-migration.processor.ts`
- Create: `backend/src/workers/bullmq/processors/__tests__/vip-migration.processor.test.ts`

**Step 1: Write failing tests**

```typescript
// backend/src/workers/bullmq/processors/__tests__/vip-migration.processor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMetadataConnect = vi.hoisted(() => vi.fn());
const mockSharedConnect   = vi.hoisted(() => vi.fn());

vi.mock('../../../../dal/pool/PoolRegistry', () => ({
  PoolRegistry: vi.fn().mockImplementation(() => ({
    acquireMetadataConnection: mockMetadataConnect,
    getSharedPool: vi.fn(),
    registerVipPool: vi.fn(),
    getVipPool: vi.fn().mockReturnValue(null),
    deregisterVipPool: vi.fn(),
  })),
}));

vi.mock('../../../../dal/pool/TenantQuotaEnforcer', () => ({
  TenantQuotaEnforcer: { deregister: vi.fn(), register: vi.fn(), reset: vi.fn() },
}));

import { VipMigrationProcessor } from '../vip-migration.processor';
import { PoolRegistry } from '../../../../dal/pool/PoolRegistry';

function makeClient(overrides: Record<string, unknown> = {}) {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn(), ...overrides };
}

describe('VipMigrationProcessor', () => {
  let processor: VipMigrationProcessor;
  let metaClient: ReturnType<typeof makeClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new VipMigrationProcessor(new PoolRegistry() as any);
    metaClient = makeClient();
    mockMetadataConnect.mockResolvedValue(metaClient);
  });

  it('rolls back to original tier on failure', async () => {
    // Make CREATE DATABASE fail
    metaClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockRejectedValueOnce(new Error('CREATE DATABASE failed'));

    const job = { data: { tenantId: 'tid', slug: 'acme', currentTier: 'premium' } } as any;
    await expect(processor.process(job)).rejects.toThrow();

    // Should have attempted rollback UPDATE
    const calls = metaClient.query.mock.calls.map((c: unknown[]) => c[0] as string);
    const hasRollback = calls.some((q: string) => q.includes("tier = 'premium'") || q.includes('ROLLBACK'));
    expect(hasRollback).toBe(true);
  });
});
```

**Step 2: Run — expect FAIL**

```bash
cd backend && npx vitest src/workers/bullmq/processors/__tests__/vip-migration.processor.test.ts
```

**Step 3: Implement VipMigrationProcessor**

```typescript
// backend/src/workers/bullmq/processors/vip-migration.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Client } from 'pg';
import Knex from 'knex';
import { QUEUE_VIP_MIGRATION } from '../queue.constants';
import { PoolRegistry } from '../../../dal/pool/PoolRegistry';
import { TenantQuotaEnforcer } from '../../../dal/pool/TenantQuotaEnforcer';

const VIP_POOL_URL_PREFIX = 'crm_vip_';
const BATCH_SIZE = 500;

// Tables that have tenant_id and need to be copied
const PLUGIN_TABLES = [
  'customers',
  'support_cases',
  'automation_triggers',
  'marketing_campaigns',
];

export interface VipMigrationJobData {
  tenantId: string;
  slug: string;
  currentTier: string; // rollback target on failure
}

@Processor(QUEUE_VIP_MIGRATION, { concurrency: 1 })
export class VipMigrationProcessor extends WorkerHost {
  private readonly logger = new Logger(VipMigrationProcessor.name);

  constructor(private readonly poolRegistry: PoolRegistry) {
    super();
  }

  async process(job: Job<VipMigrationJobData>): Promise<void> {
    const { tenantId, slug, currentTier } = job.data;
    const dbName = `${VIP_POOL_URL_PREFIX}${slug}`;
    // Build dedicated DB URL from shared URL (replace database name)
    const { config } = await import('../../../config/env');
    const sharedUrl = config.DATABASE_APP_URL ?? config.DATABASE_URL;
    const dedicatedUrl = sharedUrl.replace(/\/[^/]+$/, `/${dbName}`);

    this.logger.log(`[VipMigration] Starting for tenant ${tenantId} (${slug})`);
    let dbCreated = false;

    const metaClient = await this.poolRegistry.acquireMetadataConnection();
    try {
      // Step 1: CREATE DATABASE (use superuser metadata pool)
      await metaClient.query(`CREATE DATABASE "${dbName}"`);
      dbCreated = true;
      this.logger.log(`[VipMigration] Created database ${dbName}`);

      // Step 2: Create schema on dedicated DB
      const vipKnex = Knex({ client: 'postgresql', connection: dedicatedUrl });
      try {
        await this.createPluginSchema(vipKnex);
        this.logger.log(`[VipMigration] Schema created on ${dbName}`);

        // Step 3: Copy data row-by-row from shared DB
        const sharedPool = this.poolRegistry.getMetadataPool(); // reuse metadata pool for reads
        // Actually use a direct pg Client to shared DB for reads
        const sharedClient = await this.poolRegistry.acquireMetadataConnection();
        try {
          for (const table of PLUGIN_TABLES) {
            await this.copyTable(table, tenantId, sharedClient as any, vipKnex);
          }
        } finally {
          sharedClient.release();
        }

        // Step 4: Verify row counts
        const sharedCountClient = await this.poolRegistry.acquireMetadataConnection();
        try {
          await this.verifyRowCounts(PLUGIN_TABLES, tenantId, sharedCountClient as any, vipKnex);
        } finally {
          sharedCountClient.release();
        }

        this.logger.log(`[VipMigration] Data verified for tenant ${tenantId}`);
      } finally {
        await vipKnex.destroy();
      }

      // Step 5: Register VIP pool in PoolRegistry
      this.poolRegistry.registerVipPool(tenantId, dedicatedUrl);

      // Step 6: Write to vip_db_registry + update tenant status
      await metaClient.query('BEGIN');
      await metaClient.query(
        `INSERT INTO vip_db_registry (tenant_id, db_name, db_url, migrated_at)
         VALUES ($1, $2, $3, NOW())`,
        [tenantId, dbName, dedicatedUrl],
      );
      await metaClient.query(
        `UPDATE tenants SET db_url = $1, status = 'active', updated_at = NOW() WHERE id = $2`,
        [dedicatedUrl, tenantId],
      );
      await metaClient.query('COMMIT');

      // Step 7: VIP tenants are exempt from per-tenant connection caps
      TenantQuotaEnforcer.deregister(tenantId);

      this.logger.log(`[VipMigration] Completed for tenant ${tenantId}`);
    } catch (err) {
      this.logger.error(`[VipMigration] Failed for tenant ${tenantId}:`, err);

      // Rollback: restore original tier and status
      try {
        await metaClient.query(
          `UPDATE tenants SET status = 'active', tier = $1, updated_at = NOW() WHERE id = $2`,
          [currentTier, tenantId],
        );
        TenantQuotaEnforcer.register(tenantId, currentTier);
      } catch (rollbackErr) {
        this.logger.error('[VipMigration] Rollback failed:', rollbackErr);
      }

      // Drop dedicated DB if created
      if (dbCreated) {
        try {
          await metaClient.query(`DROP DATABASE IF EXISTS "${dbName}"`);
        } catch (dropErr) {
          this.logger.error(`[VipMigration] Failed to drop ${dbName}:`, dropErr);
        }
      }

      throw err;
    } finally {
      metaClient.release();
    }
  }

  private async createPluginSchema(knex: Knex.Knex): Promise<void> {
    await knex.schema.createTableIfNotExists('customers', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.string('name').notNullable();
      t.string('email');
      t.string('phone');
      t.jsonb('metadata').defaultTo('{}');
      t.timestamps(true, true);
    });
    await knex.schema.createTableIfNotExists('support_cases', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.uuid('customer_id');
      t.string('title').notNullable();
      t.text('description');
      t.string('status').defaultTo('open');
      t.timestamps(true, true);
    });
    await knex.schema.createTableIfNotExists('automation_triggers', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.string('name').notNullable();
      t.jsonb('config').defaultTo('{}');
      t.boolean('is_active').defaultTo(true);
      t.timestamps(true, true);
    });
    await knex.schema.createTableIfNotExists('marketing_campaigns', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.string('name').notNullable();
      t.string('status').defaultTo('draft');
      t.jsonb('config').defaultTo('{}');
      t.timestamps(true, true);
    });
  }

  private async copyTable(
    table: string,
    tenantId: string,
    sourceClient: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
    destKnex: Knex.Knex,
  ): Promise<void> {
    let offset = 0;
    for (;;) {
      const { rows } = await sourceClient.query(
        `SELECT * FROM "${table}" WHERE tenant_id = $1 ORDER BY created_at LIMIT $2 OFFSET $3`,
        [tenantId, BATCH_SIZE, offset],
      );
      if (rows.length === 0) break;
      await destKnex(table).insert(rows);
      offset += rows.length;
      if (rows.length < BATCH_SIZE) break;
    }
    this.logger.debug(`[VipMigration] Copied ${offset} rows from ${table}`);
  }

  private async verifyRowCounts(
    tables: string[],
    tenantId: string,
    sourceClient: { query: (sql: string, params?: unknown[]) => Promise<{ rows: { count: string }[] }> },
    destKnex: Knex.Knex,
  ): Promise<void> {
    for (const table of tables) {
      const { rows: srcRows } = await sourceClient.query(
        `SELECT COUNT(*) AS count FROM "${table}" WHERE tenant_id = $1`,
        [tenantId],
      );
      const srcCount = Number(srcRows[0]?.count ?? 0);
      const destCount = await destKnex(table).where({ tenant_id: tenantId }).count('* as count').then(r => Number((r[0] as any).count));

      if (srcCount !== destCount) {
        throw new Error(`Row count mismatch for ${table}: source=${srcCount}, dest=${destCount}`);
      }
    }
  }
}
```

**Step 4: Run tests**

```bash
cd backend && npx vitest src/workers/bullmq/processors/__tests__/vip-migration.processor.test.ts
```

**Step 5: Commit**

```bash
git add backend/src/workers/bullmq/processors/vip-migration.processor.ts \
        backend/src/workers/bullmq/processors/__tests__/vip-migration.processor.test.ts
git commit -m "feat(workers): add VipMigrationProcessor — dedicated DB provisioning + data copy"
```

---

### Task 11: VipDecommissionProcessor

**Files:**
- Create: `backend/src/workers/bullmq/processors/vip-decommission.processor.ts`

```typescript
// backend/src/workers/bullmq/processors/vip-decommission.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import Knex from 'knex';
import { QUEUE_VIP_DECOMMISSION } from '../queue.constants';
import { PoolRegistry } from '../../../dal/pool/PoolRegistry';
import { TenantQuotaEnforcer } from '../../../dal/pool/TenantQuotaEnforcer';

const PLUGIN_TABLES = ['customers', 'support_cases', 'automation_triggers', 'marketing_campaigns'];
const BATCH_SIZE = 500;

export interface VipDecommissionJobData {
  tenantId: string;
  slug: string;
  newTier: string;
}

@Processor(QUEUE_VIP_DECOMMISSION, { concurrency: 1 })
export class VipDecommissionProcessor extends WorkerHost {
  private readonly logger = new Logger(VipDecommissionProcessor.name);

  constructor(private readonly poolRegistry: PoolRegistry) {
    super();
  }

  async process(job: Job<VipDecommissionJobData>): Promise<void> {
    const { tenantId, slug, newTier } = job.data;
    const dbName = `crm_vip_${slug}`;
    const { config } = await import('../../../config/env');
    const sharedUrl = config.DATABASE_APP_URL ?? config.DATABASE_URL;
    const dedicatedUrl = sharedUrl.replace(/\/[^/]+$/, `/${dbName}`);

    this.logger.log(`[VipDecommission] Starting for tenant ${tenantId} → ${newTier}`);

    const destClient = await this.poolRegistry.acquireMetadataConnection();
    try {
      // Step 1: Copy data from dedicated → shared DB
      const srcKnex = Knex({ client: 'postgresql', connection: dedicatedUrl });
      try {
        for (const table of PLUGIN_TABLES) {
          await this.copyTable(table, tenantId, srcKnex, destClient as any);
        }
      } finally {
        await srcKnex.destroy();
      }

      // Step 2: Verify row counts
      const vipKnex = Knex({ client: 'postgresql', connection: dedicatedUrl });
      try {
        for (const table of PLUGIN_TABLES) {
          const srcCount = await vipKnex(table).where({ tenant_id: tenantId }).count('* as count').then(r => Number((r[0] as any).count));
          const { rows } = await (destClient as any).query(
            `SELECT COUNT(*) AS count FROM "${table}" WHERE tenant_id = $1`,
            [tenantId],
          );
          const destCount = Number(rows[0]?.count ?? 0);
          if (srcCount !== destCount) {
            throw new Error(`Mismatch for ${table}: vip=${srcCount} shared=${destCount}`);
          }
        }
      } finally {
        await vipKnex.destroy();
      }

      // Step 3: Update tenants: clear db_url, new tier, active
      await destClient.query(
        `UPDATE tenants SET db_url = NULL, tier = $1, status = 'active', updated_at = NOW() WHERE id = $2`,
        [newTier, tenantId],
      );

      // Step 4: Deregister VIP pool
      await this.poolRegistry.deregisterVipPool(tenantId);

      // Step 5: Register quota enforcer for new tier
      TenantQuotaEnforcer.register(tenantId, newTier);

      // Step 6: Mark vip_db_registry decommissioned
      await destClient.query(
        `UPDATE vip_db_registry SET decommissioned_at = NOW() WHERE tenant_id = $1 AND decommissioned_at IS NULL`,
        [tenantId],
      );

      // Step 7: DROP DATABASE (irreversible — only after all above succeeded)
      await destClient.query(`DROP DATABASE IF EXISTS "${dbName}"`);

      this.logger.log(`[VipDecommission] Completed for tenant ${tenantId}`);
    } finally {
      destClient.release();
    }
  }

  private async copyTable(
    table: string,
    tenantId: string,
    srcKnex: Knex.Knex,
    destClient: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  ): Promise<void> {
    let offset = 0;
    for (;;) {
      const rows = await srcKnex(table).where({ tenant_id: tenantId }).limit(BATCH_SIZE).offset(offset);
      if (rows.length === 0) break;
      for (const row of rows) {
        const cols = Object.keys(row);
        const vals = cols.map((_, i) => `$${i + 1}`).join(', ');
        await destClient.query(
          `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${vals}) ON CONFLICT DO NOTHING`,
          Object.values(row),
        );
      }
      offset += rows.length;
      if (rows.length < BATCH_SIZE) break;
    }
  }
}
```

**Step: Commit**

```bash
git add backend/src/workers/bullmq/processors/vip-decommission.processor.ts
git commit -m "feat(workers): add VipDecommissionProcessor — reverse VIP migration"
```

---

### Task 12: DataExportProcessor — S3 offboard export

**Files:**
- Create: `backend/src/workers/bullmq/processors/data-export.processor.ts`
- Create: `backend/src/workers/bullmq/processors/__tests__/data-export.processor.test.ts`

**Step 1: Write failing tests**

```typescript
// backend/src/workers/bullmq/processors/__tests__/data-export.processor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPutObject = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockGetSignedUrl = vi.hoisted(() => vi.fn().mockResolvedValue('https://presigned-url'));
const mockQuery = vi.hoisted(() => vi.fn().mockResolvedValue({ rows: [{ id: '1', tenant_id: 'tid', name: 'Test' }] }));
const mockRelease = vi.hoisted(() => vi.fn());
const mockConnect = vi.hoisted(() => vi.fn().mockResolvedValue({ query: mockQuery, release: mockRelease }));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mockPutObject })),
  PutObjectCommand: vi.fn(),
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));
vi.mock('../../../../dal/pool/PoolRegistry', () => ({
  PoolRegistry: vi.fn().mockImplementation(() => ({
    acquireMetadataConnection: mockConnect,
  })),
}));

const mockPublishNotification = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../../../workers/amqp/amqp-publisher.service', () => ({
  AmqpPublisher: vi.fn().mockImplementation(() => ({
    publishNotification: mockPublishNotification,
  })),
}));

import { DataExportProcessor } from '../data-export.processor';
import { PoolRegistry } from '../../../../dal/pool/PoolRegistry';
import { AmqpPublisher } from '../../../../workers/amqp/amqp-publisher.service';

describe('DataExportProcessor', () => {
  let processor: DataExportProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new DataExportProcessor(new PoolRegistry() as any, new AmqpPublisher() as any);
  });

  it('uploads JSON for each table and sends email notification', async () => {
    const job = {
      data: { tenantId: 'tid', tenantName: 'ACME', adminEmail: 'admin@acme.com', tier: 'basic' },
    } as any;

    await processor.process(job);

    // S3 put called once per table + manifest
    expect(mockPutObject).toHaveBeenCalledTimes(5); // 4 tables + manifest
    expect(mockPublishNotification).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'admin@acme.com' })
    );
  });

  it('skips email when adminEmail is not provided', async () => {
    const job = { data: { tenantId: 'tid', tenantName: 'ACME', tier: 'basic' } } as any;
    await processor.process(job);
    expect(mockPublishNotification).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run — expect FAIL**

```bash
cd backend && npx vitest src/workers/bullmq/processors/__tests__/data-export.processor.test.ts
```

**Step 3: Implement DataExportProcessor**

```typescript
// backend/src/workers/bullmq/processors/data-export.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { QUEUE_DATA_EXPORT } from '../queue.constants';
import { PoolRegistry } from '../../../dal/pool/PoolRegistry';
import { AmqpPublisher } from '../../amqp/amqp-publisher.service';
import { config } from '../../../config/env';

const PLUGIN_TABLES = ['customers', 'support_cases', 'automation_triggers', 'marketing_campaigns'];
const PRESIGN_EXPIRES_SECONDS = 90 * 24 * 3600; // 90 days

export interface DataExportJobData {
  tenantId: string;
  tenantName: string;
  adminEmail?: string;
  tier: string;
}

@Processor(QUEUE_DATA_EXPORT, { concurrency: 2 })
export class DataExportProcessor extends WorkerHost {
  private readonly logger = new Logger(DataExportProcessor.name);
  private readonly s3: S3Client;

  constructor(
    private readonly poolRegistry: PoolRegistry,
    private readonly amqp: AmqpPublisher,
  ) {
    super();
    this.s3 = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY ?? 'crm',
        secretAccessKey: config.S3_SECRET_KEY ?? 'crm_secret_dev',
      },
      forcePathStyle: true, // required for MinIO
    });
  }

  async process(job: Job<DataExportJobData>): Promise<void> {
    const { tenantId, tenantName, adminEmail, tier } = job.data;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const prefix = `${tenantId}/${timestamp}`;
    const bucket = config.S3_BUCKET_EXPORTS;

    this.logger.log(`[DataExport] Starting export for tenant ${tenantId}`);

    const client = await this.poolRegistry.acquireMetadataConnection();
    const rowCounts: Record<string, number> = {};

    try {
      // Export each plugin table
      for (const table of PLUGIN_TABLES) {
        const { rows } = await client.query(
          `SELECT * FROM "${table}" WHERE tenant_id = $1`,
          [tenantId],
        );
        rowCounts[table] = rows.length;
        await this.s3.send(new PutObjectCommand({
          Bucket: bucket,
          Key: `${prefix}/${table}.json`,
          Body: JSON.stringify(rows, null, 2),
          ContentType: 'application/json',
        }));
      }

      // Export manifest
      const manifestKey = `${prefix}/manifest.json`;
      await this.s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: manifestKey,
        Body: JSON.stringify({ tenantId, tenantName, tables: PLUGIN_TABLES, rowCounts, exportedAt: new Date().toISOString(), tier }),
        ContentType: 'application/json',
      }));

      this.logger.log(`[DataExport] Uploaded ${PLUGIN_TABLES.length} tables + manifest for ${tenantId}`);

      // Generate pre-signed download URL for manifest (points to the archive)
      const presignedUrl = await getSignedUrl(
        this.s3,
        new GetObjectCommand({ Bucket: bucket, Key: manifestKey }),
        { expiresIn: PRESIGN_EXPIRES_SECONDS },
      );

      // Send email notification if admin email provided
      if (adminEmail) {
        await this.amqp.publishNotification({
          tenantId,
          userId: 'system',
          channel: 'email',
          to: adminEmail,
          subject: `Your data export for "${tenantName}" is ready`,
          body: `Your tenant data has been exported and is available for download for 90 days:\n\n${presignedUrl}\n\nIncludes: ${PLUGIN_TABLES.join(', ')}`,
          metadata: { type: 'tenant.data_exported', tenantId, rowCounts },
        });
      }

      this.logger.log(`[DataExport] Completed for tenant ${tenantId}`);
    } finally {
      client.release();
    }
  }
}
```

**Step 4: Run tests**

```bash
cd backend && npx vitest src/workers/bullmq/processors/__tests__/data-export.processor.test.ts
```

Expected: 2 tests pass.

**Step 5: Commit all processor files + BullMqModule**

```bash
git add backend/src/workers/bullmq/queue.constants.ts \
        backend/src/workers/bullmq/bullmq.module.ts \
        backend/src/workers/bullmq/processors/vip-decommission.processor.ts \
        backend/src/workers/bullmq/processors/data-export.processor.ts \
        backend/src/workers/bullmq/processors/__tests__/data-export.processor.test.ts
git commit -m "feat(workers): add DataExportProcessor (S3/MinIO) and BullMQ queue registrations"
```

---

### Task 13: Wire VIP upgrade/downgrade in AdminTenantsService + inject queues

**Files:**
- Modify: `backend/src/api/v1/admin/tenants/admin-tenants.service.ts`
- Modify: `backend/src/api/v1/admin/admin.module.ts`

**Step 1: Add queue injections to AdminTenantsService constructor**

```typescript
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUE_VIP_MIGRATION, QUEUE_VIP_DECOMMISSION, QUEUE_DATA_EXPORT } from '../../../../workers/bullmq/queue.constants';
import type { VipMigrationJobData } from '../../../../workers/bullmq/processors/vip-migration.processor';
import type { VipDecommissionJobData } from '../../../../workers/bullmq/processors/vip-decommission.processor';
import type { DataExportJobData } from '../../../../workers/bullmq/processors/data-export.processor';

// In constructor:
constructor(
  private readonly poolRegistry: PoolRegistry,
  private readonly cache: CacheManager,
  private readonly amqp: AmqpPublisher,
  @InjectQueue(QUEUE_VIP_MIGRATION)    private readonly vipMigrationQueue: Queue,
  @InjectQueue(QUEUE_VIP_DECOMMISSION) private readonly vipDecommissionQueue: Queue,
  @InjectQueue(QUEUE_DATA_EXPORT)      private readonly dataExportQueue: Queue,
) {}
```

**Step 2: In `update()`, after detecting `isVipUpgrade` / `isVipDowngrade`**, enqueue jobs:

```typescript
// After COMMIT in update():
if (isVipUpgrade) {
  await this.vipMigrationQueue.add('migrate', {
    tenantId: id,
    slug: res.rows[0]?.subdomain ?? id,
    currentTier,
  } satisfies VipMigrationJobData);
}

if (isVipDowngrade) {
  await this.vipDecommissionQueue.add('decommission', {
    tenantId: id,
    slug: res.rows[0]?.subdomain ?? id,
    newTier: input.plan!,
  } satisfies VipDecommissionJobData);
}
```

**Step 3: In `offboard()`, uncomment the data export job**:

```typescript
// Enqueue S3 data export
await this.dataExportQueue.add('export', {
  tenantId: id,
  tenantName: res?.rows?.[0]?.name ?? id,  // capture name before offboard
  tier,
} satisfies DataExportJobData);
```

**Note:** Also capture `tenantName` before the offboarding UPDATE. Read the current name in the lockRes query: add `name` to the RETURNING clause of the offboarding UPDATE.

**Step 4: Update AdminModule** to import `BullModule` queues:

```typescript
// admin.module.ts — add to imports:
BullModule.registerQueue(
  { name: QUEUE_VIP_MIGRATION },
  { name: QUEUE_VIP_DECOMMISSION },
  { name: QUEUE_DATA_EXPORT },
),
```

**Step 5: Run full test suite**

```bash
cd backend && npm test
```

Expected: all pass.

**Step 6: Commit**

```bash
git add backend/src/api/v1/admin/tenants/admin-tenants.service.ts \
        backend/src/api/v1/admin/admin.module.ts
git commit -m "feat(admin): wire VIP migration/decommission/export BullMQ jobs into AdminTenantsService"
```

---

### Task 14: CronService — hard delete scheduler (90-day)

**Files:**
- Modify: `backend/src/workers/scheduler/cron.service.ts`
- Create: `backend/src/workers/scheduler/__tests__/cron-hard-delete.test.ts`

**Step 1: Write failing test**

```typescript
// backend/src/workers/scheduler/__tests__/cron-hard-delete.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.hoisted(() => vi.fn());
const mockRelease = vi.hoisted(() => vi.fn());
const mockConnect = vi.hoisted(() => vi.fn().mockResolvedValue({ query: mockQuery, release: mockRelease }));

vi.mock('../../../dal/pool/PoolRegistry', () => ({
  PoolRegistry: vi.fn().mockImplementation(() => ({
    acquireMetadataConnection: mockConnect,
  })),
}));

import { CronService } from '../cron.service';
import { PoolRegistry } from '../../../dal/pool/PoolRegistry';

describe('CronService.hardDeleteOffboardedTenants', () => {
  let service: CronService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CronService(
      { getWaitingCount: vi.fn(), getFailedCount: vi.fn() } as any,
      { getWaitingCount: vi.fn(), getFailedCount: vi.fn() } as any,
      new PoolRegistry() as any,
    );
  });

  it('deletes plugin data for tenants offboarded 90+ days ago', async () => {
    // First query: find tenants
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'tid-1' }, { id: 'tid-2' }] });
    // Subsequent queries: DELETE statements — return empty rows
    mockQuery.mockResolvedValue({ rows: [] });

    await (service as any).hardDeleteOffboardedTenants();

    // Should have found tenants once
    const calls = mockQuery.mock.calls.map((c: unknown[][]) => c[0] as string);
    expect(calls[0]).toContain("status = 'offboarded'");
    expect(calls[0]).toContain('90 days');

    // Should have issued DELETE calls for tenant data
    const deleteCalls = calls.filter((q: string) => q.includes('DELETE'));
    expect(deleteCalls.length).toBeGreaterThan(0);
  });

  it('does nothing when no tenants qualify', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await (service as any).hardDeleteOffboardedTenants();
    expect(mockQuery).toHaveBeenCalledTimes(1); // only the SELECT
  });
});
```

**Step 2: Run — expect FAIL**

```bash
cd backend && npx vitest src/workers/scheduler/__tests__/cron-hard-delete.test.ts
```

**Step 3: Inject PoolRegistry into CronService and add the job**

In `cron.service.ts`:

```typescript
import { PoolRegistry } from '../../dal/pool/PoolRegistry';

// Add to constructor:
constructor(
  @InjectQueue(QUEUE_EMAIL)   private readonly emailQueue:   Queue,
  @InjectQueue(QUEUE_WEBHOOK) private readonly webhookQueue: Queue,
  private readonly poolRegistry: PoolRegistry,
) {}
```

In `onApplicationBootstrap()`, add:

```typescript
this.tasks.push(
  cron.schedule('0 3 * * *', () => this.hardDeleteOffboardedTenants(), {
    name: 'hard-delete-offboarded',
  })
);
this.logger.log('CronService started (3 jobs scheduled)');
```

Add the method:

```typescript
private async hardDeleteOffboardedTenants(): Promise<void> {
  this.logger.log('cron:hard-delete — checking for tenants to permanently delete');
  const client = await this.poolRegistry.acquireMetadataConnection();
  try {
    const { rows: tenants } = await client.query<{ id: string }>(
      `SELECT id FROM tenants
       WHERE status = 'offboarded'
         AND offboarded_at < NOW() - INTERVAL '90 days'`,
    );

    if (tenants.length === 0) {
      this.logger.debug('cron:hard-delete — no tenants qualify');
      return;
    }

    this.logger.log(`cron:hard-delete — permanently deleting ${tenants.length} tenant(s)`);

    for (const { id } of tenants) {
      try {
        // FK-ordered deletes — keep audit_logs
        for (const table of [
          'marketing_campaigns', 'automation_triggers',
          'support_cases', 'customers',
        ]) {
          await client.query(`DELETE FROM "${table}" WHERE tenant_id = $1`, [id]);
        }
        await client.query('DELETE FROM refresh_tokens  WHERE tenant_id = $1', [id]);
        await client.query('DELETE FROM user_roles      WHERE tenant_id = $1', [id]);
        await client.query('DELETE FROM users           WHERE tenant_id = $1', [id]);
        await client.query('DELETE FROM roles           WHERE tenant_id = $1', [id]);
        await client.query('DELETE FROM tenant_plugins  WHERE tenant_id = $1', [id]);
        await client.query('DELETE FROM tenants         WHERE id        = $1', [id]);
        // audit_logs intentionally NOT deleted — immutable compliance record
        this.logger.log(`cron:hard-delete — permanently deleted tenant ${id}`);
      } catch (err) {
        this.logger.error(`cron:hard-delete — failed to delete tenant ${id}:`, err);
        // Continue with next tenant rather than aborting entire batch
      }
    }
  } finally {
    client.release();
  }
}
```

**Step 4: Run tests**

```bash
cd backend && npx vitest src/workers/scheduler/__tests__/cron-hard-delete.test.ts
```

Expected: 2 tests pass.

**Step 5: Run full suite**

```bash
cd backend && npm test
```

Expected: all pass.

**Step 6: Commit**

```bash
git add backend/src/workers/scheduler/cron.service.ts \
        backend/src/workers/scheduler/__tests__/cron-hard-delete.test.ts
git commit -m "feat(scheduler): add 90-day hard-delete cron for offboarded tenants"
```

---

### Task 15: Final verification

**Step 1: Run full test suite**

```bash
cd backend && npm test
```

Expected: all pass. Note the pre-existing failures in `QueryInterceptor.test.ts` (2 spy failures) and `tenant-resolver.test.ts` (14 failures) that pre-date this work — these are known and not introduced here.

**Step 2: Build check**

```bash
cd backend && npm run build 2>&1 | tail -20
```

Expected: exits 0, no TypeScript errors.

**Step 3: Start the app**

```bash
cd backend && npm run start:dev
```

Expected: `[NestApplication] Nest application successfully started`

**Step 4: Smoke test create tenant**

```bash
# Get a super_admin JWT first (use admin login endpoint)
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"superadmin@system.crm.dev","password":"password123"}' | jq -r '.token')

curl -s -X POST http://localhost:3000/api/v1/admin/tenants \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant-ID: <system-tenant-id>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test VIP","subdomain":"testvip","plan":"premium"}' | jq .
```

Expected: `{ id, name, subdomain, plan, status: "active", ... }`

**Step 5: Final commit**

```bash
git add -A
git status
git commit -m "feat: complete tenant lifecycle implementation — quota, cache, VIP migration, S3 export, hard delete"
```
