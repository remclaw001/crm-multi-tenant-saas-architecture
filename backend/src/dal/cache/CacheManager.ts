import type { Redis } from 'ioredis';
import { encode, decode } from '@msgpack/msgpack';
import type { ICacheManager } from '../interfaces/ICacheManager';
import { TenantContext } from '../context/TenantContext';

// ============================================================
// CacheManager — ioredis wrapper với tenant-aware key pattern
//
// Key pattern: t:<tenantId>:<resourceType>:<id>
//   t:abc-123:customer:cust-001
//   t:abc-123:deal:deal-999
//   t:abc-123:tenant-config:abc-123
//
// Serialization: MessagePack (compact binary, ~30% nhỏ hơn JSON)
// Tenant isolation: key prefix enforce — tenant A không thể
//   đọc key của tenant B kể cả khi biết ID
//
// Tất cả operation tự động lấy tenantId từ TenantContext.
// Nếu gọi ngoài context → requireTenantId() throw.
// ============================================================

const DEFAULT_TTL_SECONDS = 300; // 5 phút

export class CacheManager implements ICacheManager {
  constructor(private readonly redis: Redis) {}

  /** Expose raw Redis client for services that need direct access without TenantContext. */
  get client(): Redis {
    return this.redis;
  }

  // ── Key building ─────────────────────────────────────────

  /**
   * Tạo canonical cache key theo pattern chuẩn.
   * Throw nếu gọi ngoài TenantContext.
   */
  buildKey(resource: string, id: string): string {
    const tenantId = TenantContext.requireTenantId();
    return `t:${tenantId}:${resource}:${id}`;
  }

  // ── CRUD operations ──────────────────────────────────────

  async get<T>(resource: string, id: string): Promise<T | null> {
    const key = this.buildKey(resource, id);
    // getBuffer trả về Buffer — cần thiết cho MessagePack decode
    const raw = await this.redis.getBuffer(key);
    if (!raw) return null;
    return decode(raw) as T;
  }

  async set<T>(
    resource: string,
    id: string,
    value: T,
    ttlSeconds = DEFAULT_TTL_SECONDS
  ): Promise<void> {
    const key = this.buildKey(resource, id);
    // encode() trả về Uint8Array — wrap thành Buffer cho ioredis
    const packed = Buffer.from(encode(value));
    await this.redis.set(key, packed, 'EX', ttlSeconds);
  }

  async del(resource: string, id: string): Promise<void> {
    const key = this.buildKey(resource, id);
    await this.redis.del(key);
  }

  /**
   * Xóa cache key trực tiếp với tenantId cho trước — không cần TenantContext.
   * Dùng cho admin routes (bypass TenantResolverMiddleware).
   */
  async delForTenant(tenantId: string, resource: string, id: string): Promise<void> {
    const key = `t:${tenantId}:${resource}:${id}`;
    await this.redis.del(key);
  }

  // ── Bulk invalidation ────────────────────────────────────

  /**
   * Xóa tất cả entry của một resource type trong tenant hiện tại.
   * Dùng SCAN thay vì KEYS để không block Redis.
   *
   * e.g. invalidateResource('customer') xóa t:<tenantId>:customer:*
   */
  async invalidateResource(resource: string): Promise<void> {
    const tenantId = TenantContext.requireTenantId();
    const pattern = `t:${tenantId}:${resource}:*`;
    const keys = await this.scanKeys(pattern);
    if (keys.length > 0) {
      // Xóa tất cả cùng lúc — DEL hỗ trợ nhiều key
      await this.redis.del(...keys);
    }
  }

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
   * TTL: 5 minutes.
   */
  async setTenantLookup(tenant: {
    id: string;
    subdomain: string | null;
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

  // ── Internal helpers ─────────────────────────────────────

  /**
   * Lấy tất cả key khớp pattern bằng SCAN (non-blocking).
   * SCAN cursor-based tránh block Redis như KEYS.
   */
  private async scanKeys(pattern: string): Promise<string[]> {
    const results: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100 // Số key quét mỗi iteration
      );
      cursor = nextCursor;
      results.push(...keys);
    } while (cursor !== '0');

    return results;
  }
}
