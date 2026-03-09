# Tenant Lifecycle — Implementation Design

**Date:** 2026-03-09
**Goal:** Implement the missing parts of `docs/crm-tenant-lifecycle.html` that exist as architectural plans but have no corresponding code.

---

## Scope

Eight gap areas identified by comparing the HTML doc against the codebase:

| # | Feature | Status before |
|---|---------|---------------|
| 1 | Redis domain-map cache in TenantResolverMiddleware | Direct DB query on every request |
| 2 | `CacheManager.flushTenant()` — full Redis SCAN+DEL | Only deletes specific keys |
| 3 | `TenantQuotaEnforcer` — per-tenant DB connection caps | No enforcement |
| 4 | VIP dedicated DB migration (upgrade + downgrade) | Only changes `tier` column |
| 5 | Offboard: full Redis flush + pool deregister + audit trail | Partial Redis flush, no audit |
| 6 | Offboard: S3 data export via MinIO | TODO comment only |
| 7 | Hard delete scheduler (90-day cron) | Not implemented |
| 8 | Provisioning/offboard: `tenant-lookup` cache invalidation | Not done |

---

## Key Decisions

- **VIP dedicated DB:** Separate PostgreSQL database (`crm_vip_<slug>`) within the same server instance
- **S3 storage:** MinIO (added to docker-compose default profile)
- **VIP migration execution:** BullMQ async job (client polls tenant status)
- **Data copy strategy:** Row-by-row via Knex in batches of 500

---

## Section 1: Infrastructure & Data Layer

### New Migration (7)

File: `backend/src/db/migrations/20260309000007_tenant_lifecycle.ts`

```sql
-- offboarded_at timestamp for hard-delete scheduler
ALTER TABLE tenants ADD COLUMN offboarded_at TIMESTAMPTZ NULL;

-- Registry of VIP dedicated databases
CREATE TABLE vip_db_registry (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  db_name           TEXT NOT NULL,
  db_url            TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  migrated_at       TIMESTAMPTZ NULL,
  decommissioned_at TIMESTAMPTZ NULL
);
CREATE INDEX idx_vip_db_registry_tenant ON vip_db_registry(tenant_id);
```

> `tenants.db_url` already exists in the schema and is used by PoolRegistry.

### MinIO (docker-compose)

Added to default profile (alongside postgres/redis/rabbitmq):

```yaml
minio:
  image: minio/minio:latest
  ports: ["9000:9000", "9001:9001"]
  environment:
    MINIO_ROOT_USER: crm
    MINIO_ROOT_PASSWORD: crm_secret
  command: server /data --console-address ":9001"
  volumes: [minio_data:/data]

minio-init:
  image: minio/mc:latest
  depends_on: [minio]
  entrypoint: >
    /bin/sh -c "mc alias set local http://minio:9000 crm crm_secret &&
                mc mb --ignore-existing local/crm-exports"
```

New env vars:
```
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=crm
S3_SECRET_KEY=crm_secret
S3_BUCKET_EXPORTS=crm-exports
```

### New BullMQ Queues

| Constant | Queue name | Concurrency | Retries | Purpose |
|----------|-----------|-------------|---------|---------|
| `QUEUE_VIP_MIGRATION` | `vip-migration` | 1 | 0 (fail fast) | VIP DB provisioning + data copy |
| `QUEUE_VIP_DECOMMISSION` | `vip-decommission` | 1 | 2 | Drop dedicated DB after downgrade |
| `QUEUE_DATA_EXPORT` | `data-export` | 2 | 3 | S3 export on offboard |

---

## Section 2: Redis Domain-Map Cache + TenantQuotaEnforcer

### CacheManager additions

Three new methods on `CacheManager`:

```typescript
// Cache-aside for tenant lookups (TTL 5min)
getTenantLookup(identifier: string): Promise<ResolvedTenant | null>
setTenantLookup(tenant: ResolvedTenant): Promise<void>  // writes two keys: by id + by subdomain
invalidateTenantLookup(tenantId: string, subdomain: string | null): Promise<void>

// Full tenant cache wipe using Redis SCAN cursor (no KEYS command)
// Patterns: t:<tenantId>:*  and  rl:<tenantId>:*
flushTenant(tenantId: string): Promise<void>
```

### TenantResolverMiddleware changes

```
lookupTenant(identifier):
  1. await cache.getTenantLookup(identifier)  → return if hit
  2. query PostgreSQL metadata pool
  3. if found: await cache.setTenantLookup(result)
  4. return result
```

Cache is invalidated (not just the lookup key but the full lookup pair) whenever AdminTenantsService creates, updates, or offboards a tenant.

### TenantQuotaEnforcer

New class: `src/dal/pool/TenantQuotaEnforcer.ts`

In-memory semaphore (Map) with per-tier caps:

| Tier | Max connections |
|------|----------------|
| basic | 10 |
| premium | 20 |
| enterprise | 30 |
| vip | exempt (dedicated pool) |

API:
- `register(tenantId, tier)` — called on tenant create
- `acquire(tenantId)` — increment counter; if `current >= max`, wait up to 5s then throw `ServiceUnavailableException(503)`
- `release(tenantId)` — decrement counter
- `updateCap(tenantId, tier)` — called on tier change
- `deregister(tenantId)` — called on offboard or VIP upgrade

`QueryInterceptor` wraps `acquire()`/`release()` around every DB connection acquire. `TenantQuotaEnforcer` is exported from `DalModule` (@Global) so `AdminTenantsService` can call lifecycle methods.

VIP tenants bypass `acquire()` — they use `PoolRegistry.getVipPool(tenantId)` directly.

---

## Section 3: VIP Migration Flow

### Upgrade to VIP

`AdminTenantsService.update()` detects `plan === 'vip'` when current tier ≠ `'vip'`:

1. `UPDATE tenants SET status='migrating', tier='vip'`
2. `cache.invalidateTenantLookup(id, subdomain)`
3. `quotaEnforcer.deregister(tenantId)` — free slot before migration starts
4. Enqueue `vip-migration` job `{ tenantId, slug, currentTier }`
5. Return updated tenant (status='migrating') — client polls for status='active'

**`VipMigrationProcessor`** steps:

```
1. CREATE DATABASE crm_vip_<slug>
2. Run plugin schema DDL on new DB:
   customers, support_cases, automation_triggers, marketing_campaigns
   (keep tenant_id column — QueryInterceptor requires it)
3. For each table, copy rows in batches of 500:
   SELECT * FROM <table> WHERE tenant_id=$1  (shared pool)
   INSERT INTO <table> VALUES (...)           (dedicated pool)
4. Verify: row count on shared == row count on dedicated (per table)
5. INSERT INTO vip_db_registry (tenant_id, db_name, db_url, migrated_at=NOW())
6. UPDATE tenants SET db_url=<dedicatedUrl>, status='active'
7. PoolRegistry.registerVipPool(tenantId, dbUrl)
8. cache.invalidateTenantLookup(tenantId, slug)
```

On failure at any step:
- `UPDATE tenants SET status='active', tier=<currentTier>` (rollback tier)
- `quotaEnforcer.register(tenantId, currentTier)` (restore quota slot)
- `DROP DATABASE crm_vip_<slug>` if already created
- No BullMQ retry (fail fast)

### Downgrade from VIP

`AdminTenantsService.update()` detects current tier is `'vip'` and new plan ≠ `'vip'`:

1. `UPDATE tenants SET status='migrating'`
2. Enqueue `vip-decommission` job `{ tenantId, newTier }`

**`VipDecommissionProcessor`** steps:

```
1. Copy data from dedicated DB → shared DB (row-by-row, batch 500)
2. Verify row counts
3. UPDATE tenants SET db_url=NULL, tier=<newTier>, status='active'
4. PoolRegistry.deregisterVipPool(tenantId)
5. quotaEnforcer.register(tenantId, newTier)
6. UPDATE vip_db_registry SET decommissioned_at=NOW()
7. DROP DATABASE crm_vip_<slug>
8. cache.invalidateTenantLookup(tenantId, slug)
```

### PoolRegistry additions

```typescript
registerVipPool(tenantId: string, dbUrl: string): void
deregisterVipPool(tenantId: string): Promise<void>  // drain + destroy pool
getVipPool(tenantId: string): Pool | null
// acquireConnection() already checks vip map first; this remains unchanged
```

---

## Section 4: Offboard Pipeline + S3 Export + Hard Delete

### Offboard flow (refactored)

```
Transaction:
  1. UPDATE status='offboarding', is_active=false
  2. UPDATE tenant_plugins SET is_enabled=false
  3. UPDATE status='offboarded', subdomain=NULL, offboarded_at=NOW()
  4. COMMIT

Post-transaction:
  5. quotaEnforcer.deregister(tenantId)
  6. cache.flushTenant(tenantId)             ← full SCAN+DEL
  7. cache.invalidateTenantLookup(tenantId, null)
  8. amqp.publishAudit({ action: 'tenant.offboarded', tenantId, ... })
  9. Enqueue 'data-export' job { tenantId, tenantName, adminEmail }
  10. If VIP: PoolRegistry.deregisterVipPool(tenantId)
              UPDATE vip_db_registry SET decommissioned_at=NOW()
              (data already exported; DROP DATABASE handled in export job cleanup)
```

### DataExportProcessor

```
1. Connect to S3 (MinIO via @aws-sdk/client-s3)
2. timestamp = ISO string
3. For each table [customers, support_cases, automation_triggers, marketing_campaigns]:
     rows = SELECT * FROM <table> WHERE tenant_id=$1
     PUT crm-exports/<tenantId>/<timestamp>/<table>.json
4. PUT crm-exports/<tenantId>/<timestamp>/manifest.json
     { tenantId, tables, rowCounts, exportedAt, tier }
5. Generate pre-signed URL (expire: 90 days)
6. amqp.publishNotification({
     channel: 'email',
     to: adminEmail,
     subject: 'Your data export is ready',
     body: presignedUrl
   })
```

### Hard Delete Scheduler

New cron in `CronService`: `0 3 * * *` (3 AM daily)

```typescript
// Find tenants ready for hard delete (offboarded 90+ days ago)
SELECT id FROM tenants
WHERE status = 'offboarded'
  AND offboarded_at < NOW() - INTERVAL '90 days'

// For each tenant (metadata pool, ordered deletes for FK):
DELETE FROM marketing_campaigns WHERE tenant_id=$1
DELETE FROM automation_triggers  WHERE tenant_id=$1
DELETE FROM support_cases        WHERE tenant_id=$1
DELETE FROM customers            WHERE tenant_id=$1
DELETE FROM refresh_tokens       WHERE tenant_id=$1
DELETE FROM user_roles           WHERE tenant_id=$1
DELETE FROM users                WHERE tenant_id=$1
DELETE FROM roles                WHERE tenant_id=$1
DELETE FROM tenant_plugins       WHERE tenant_id=$1
DELETE FROM tenants              WHERE id=$1
-- audit_logs: NEVER deleted
```

---

## File Map

### New files
```
backend/src/db/migrations/20260309000007_tenant_lifecycle.ts
backend/src/dal/pool/TenantQuotaEnforcer.ts
backend/src/workers/bullmq/processors/vip-migration.processor.ts
backend/src/workers/bullmq/processors/vip-decommission.processor.ts
backend/src/workers/bullmq/processors/data-export.processor.ts
backend/src/workers/bullmq/queues.ts                             ← add 3 new queue constants
```

### Modified files
```
backend/docker-compose.yml                                        ← add minio + minio-init
backend/src/config/env.ts                                         ← add S3_* vars
backend/src/dal/cache/CacheManager.ts                             ← flushTenant, getTenantLookup, etc.
backend/src/dal/pool/PoolRegistry.ts                              ← registerVipPool, deregisterVipPool
backend/src/dal/dal.module.ts                                     ← export TenantQuotaEnforcer
backend/src/dal/interceptor/QueryInterceptor.ts                   ← wrap acquire/release
backend/src/gateway/middleware/tenant-resolver.middleware.ts      ← cache-aside
backend/src/api/v1/admin/tenants/admin-tenants.service.ts         ← VIP upgrade/downgrade, offboard
backend/src/workers/bullmq/bullmq.module.ts                       ← register 3 new queues + processors
backend/src/workers/scheduler/cron.service.ts                     ← add hard-delete job
```

---

## Testing Strategy

- Unit tests for `TenantQuotaEnforcer` (acquire/release/cap logic)
- Unit tests for `CacheManager` new methods (mock Redis)
- Unit tests for `VipMigrationProcessor` (mock pools, mock DB calls)
- Unit tests for `DataExportProcessor` (mock S3 client, mock DB)
- Unit tests for hard delete scheduler (mock DB, verify correct tables deleted)
- Existing tests must continue to pass
