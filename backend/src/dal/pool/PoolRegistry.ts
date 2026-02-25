import { Pool, PoolClient } from 'pg';
import { config } from '../../config/env';
import { TenantContext } from '../context/TenantContext';

// ============================================================
// PoolRegistry — quản lý Connection Pool theo tier
//
// 3 loại pool:
//   shared   — max 200 conn, toàn bộ standard tenant dùng chung
//   metadata — max 20 conn, system ops (tenant lookup, migrations)
//   vip      — max 30 conn per VIP/Enterprise tenant, tạo on-demand
//
// Lifecycle của connection:
//   1. acquireConnection()    → pool.connect()
//   2. SET app.tenant_id      → kích hoạt RLS
//   3. ... query thực thi ... → RLS enforce tenant isolation
//   4. release()              → reset app.tenant_id → về pool
//
// Pool afterCreate (trong knexfile.ts) đã reset khi connection
// mới được tạo — đây là defense-in-depth thứ hai.
// ============================================================

interface PoolCreateOptions {
  connectionString: string;
  max: number;
  name: string;
}

function buildPool({ connectionString, max, name }: PoolCreateOptions): Pool {
  const pool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  pool.on('error', (err) => {
    // Log nhưng không crash — pool tự recover
    console.error(`[PoolRegistry:${name}] Idle client error:`, err.message);
  });

  return pool;
}

/**
 * UUID validation — tenant_id chỉ chứa hex và dashes.
 * Ngăn SQL injection trước khi interpolate vào SET command.
 */
function assertValidUuid(id: string, label = 'tenant_id'): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(`PoolRegistry: invalid ${label} format: "${id}"`);
  }
}

export class PoolRegistry {
  private readonly sharedPool: Pool;
  private readonly metadataPool: Pool;
  /** VIP/Enterprise pools — key: tenantId */
  private readonly vipPools = new Map<string, Pool>();

  constructor() {
    this.sharedPool = buildPool({
      connectionString: config.DATABASE_URL,
      max: config.DATABASE_POOL_MAX, // 200
      name: 'shared',
    });

    this.metadataPool = buildPool({
      connectionString: config.DATABASE_METADATA_URL ?? config.DATABASE_URL,
      max: config.DATABASE_METADATA_POOL_MAX, // 20
      name: 'metadata',
    });
  }

  // ── Pool management ──────────────────────────────────────

  /**
   * Đăng ký dedicated pool cho VIP/Enterprise tenant.
   * Idempotent — gọi nhiều lần với cùng tenantId không tạo pool mới.
   */
  registerVipPool(tenantId: string, dbUrl: string): void {
    assertValidUuid(tenantId);
    if (!this.vipPools.has(tenantId)) {
      this.vipPools.set(
        tenantId,
        buildPool({ connectionString: dbUrl, max: 30, name: `vip:${tenantId.slice(0, 8)}` })
      );
    }
  }

  /**
   * Trả về pool phù hợp theo tier của tenant.
   * VIP/Enterprise dùng dedicated pool nếu đã được đăng ký,
   * ngược lại fallback về shared pool.
   */
  getPool(
    tier: 'standard' | 'vip' | 'enterprise',
    tenantId?: string
  ): Pool {
    if (tier !== 'standard' && tenantId && this.vipPools.has(tenantId)) {
      return this.vipPools.get(tenantId)!;
    }
    return this.sharedPool;
  }

  /** Pool dành cho system operations — bypass RLS. */
  getMetadataPool(): Pool {
    return this.metadataPool;
  }

  // ── Connection acquisition ───────────────────────────────

  /**
   * Lấy connection đã được scoped theo tenant từ pool phù hợp.
   *
   * - SET app.tenant_id = tenantId (kích hoạt RLS policies)
   * - Wrap release() để reset app.tenant_id trước khi trả về pool
   *   → đảm bảo không có context leak giữa các request
   *
   * Nếu không truyền tenantId, tự động lấy từ TenantContext.
   */
  async acquireConnection(
    tier: 'standard' | 'vip' | 'enterprise',
    tenantId?: string
  ): Promise<PoolClient> {
    const effectiveTenantId = tenantId ?? TenantContext.getTenantId();
    const pool = this.getPool(tier, effectiveTenantId);
    const client = await pool.connect();

    // Bọc release() để luôn reset tenant context trước khi trả connection về pool
    const _release = client.release.bind(client);
    (client as any).release = async (err?: Error | boolean) => {
      try {
        // Dùng SET (session-level) vì afterCreate trong knexfile chỉ chạy
        // khi connection mới được TẠO, không phải khi được ACQUIRE từ pool
        await client.query(`SET "app.tenant_id" = ''`);
      } catch {
        // Connection có thể bị broken — pool sẽ discard nó
      }
      _release(err);
    };

    // Kích hoạt RLS cho connection này
    if (effectiveTenantId) {
      assertValidUuid(effectiveTenantId);
      await client.query(`SET "app.tenant_id" = '${effectiveTenantId}'`);
    }

    return client;
  }

  /**
   * Lấy connection từ metadata pool (không set tenant context).
   * Dùng cho: tenant lookup, migration, system health checks.
   */
  async acquireMetadataConnection(): Promise<PoolClient> {
    return this.metadataPool.connect();
  }

  // ── Observability ────────────────────────────────────────

  /** Thống kê pool — expose cho Prometheus metrics (Phase 4). */
  getStats() {
    return {
      shared: {
        total: this.sharedPool.totalCount,
        idle: this.sharedPool.idleCount,
        waiting: this.sharedPool.waitingCount,
      },
      metadata: {
        total: this.metadataPool.totalCount,
        idle: this.metadataPool.idleCount,
        waiting: this.metadataPool.waitingCount,
      },
      vipPools: [...this.vipPools.entries()].map(([id, p]) => ({
        tenantId: id,
        total: p.totalCount,
        idle: p.idleCount,
        waiting: p.waitingCount,
      })),
    };
  }

  // ── Lifecycle ────────────────────────────────────────────

  /** Graceful shutdown — đóng tất cả pool connections. */
  async shutdown(): Promise<void> {
    await Promise.all([
      this.sharedPool.end(),
      this.metadataPool.end(),
      ...[...this.vipPools.values()].map((p) => p.end()),
    ]);
  }
}
