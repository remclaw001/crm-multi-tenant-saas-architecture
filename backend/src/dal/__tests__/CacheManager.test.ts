import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CacheManager } from '../cache/CacheManager';
import { TenantContext } from '../context/TenantContext';

// ============================================================
// CacheManager unit tests
//
// Dùng ioredis-mock — không cần Redis thật để chạy unit test.
// Integration test với Redis thật nằm trong __tests__/integration/.
//
// Verify:
// 1. Key pattern đúng: t:<tenantId>:<resource>:<id>
// 2. Set/get round-trip qua MessagePack
// 3. Cache miss → null
// 4. del xóa đúng entry
// 5. Tenant isolation — Tenant A không đọc được cache Tenant B
// 6. requireTenantId throw khi ngoài context
// ============================================================

// Lazy import để tránh lỗi nếu ioredis-mock chưa install
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let IORedisMock: any;
let redis: InstanceType<typeof IORedisMock>;
let cache: CacheManager;

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// vitest cho phép dynamic import trong test file
beforeEach(async () => {
  // Dynamic import — ioredis-mock phải được install
  const mod = await import('ioredis-mock');
  IORedisMock = mod.default;
  redis = new IORedisMock();
  cache = new CacheManager(redis as any);
  await redis.flushall();
});

describe('CacheManager', () => {
  describe('buildKey', () => {
    it('tạo key đúng pattern t:<tenantId>:<resource>:<id>', () => {
      TenantContext.run({ tenantId: TENANT_A, tenantTier: 'basic' }, () => {
        expect(cache.buildKey('customer', 'cust-001')).toBe(
          `t:${TENANT_A}:customer:cust-001`
        );
      });
    });

    it('throw khi gọi ngoài TenantContext', () => {
      expect(() => cache.buildKey('customer', '1')).toThrow(
        'TenantContext: no active tenant'
      );
    });
  });

  describe('set / get', () => {
    it('round-trip đơn giản', async () => {
      const payload = { name: 'Acme Corp', score: 42 };

      await TenantContext.run(
        { tenantId: TENANT_A, tenantTier: 'basic' },
        async () => {
          await cache.set('customer', '1', payload);
          const result = await cache.get<typeof payload>('customer', '1');
          expect(result).toEqual(payload);
        }
      );
    });

    it('hỗ trợ nhiều kiểu dữ liệu', async () => {
      const data = {
        string: 'hello',
        number: 3.14,
        boolean: true,
        array: [1, 2, 3],
        nested: { a: { b: 'deep' } },
      };

      await TenantContext.run(
        { tenantId: TENANT_A, tenantTier: 'basic' },
        async () => {
          await cache.set('config', 'main', data);
          const result = await cache.get<typeof data>('config', 'main');
          expect(result).toEqual(data);
        }
      );
    });

    it('trả về null khi cache miss', async () => {
      await TenantContext.run(
        { tenantId: TENANT_A, tenantTier: 'basic' },
        async () => {
          const result = await cache.get('customer', 'nonexistent-id');
          expect(result).toBeNull();
        }
      );
    });
  });

  describe('del', () => {
    it('xóa entry chính xác', async () => {
      await TenantContext.run(
        { tenantId: TENANT_A, tenantTier: 'basic' },
        async () => {
          await cache.set('customer', '2', { x: 1 });
          await cache.del('customer', '2');
          expect(await cache.get('customer', '2')).toBeNull();
        }
      );
    });

    it('không ảnh hưởng đến entry khác', async () => {
      await TenantContext.run(
        { tenantId: TENANT_A, tenantTier: 'basic' },
        async () => {
          await cache.set('customer', 'keep', { keep: true });
          await cache.set('customer', 'delete', { delete: true });
          await cache.del('customer', 'delete');

          expect(await cache.get('customer', 'keep')).toEqual({ keep: true });
          expect(await cache.get('customer', 'delete')).toBeNull();
        }
      );
    });
  });

  describe('tenant isolation', () => {
    it('Tenant A không đọc được cache của Tenant B', async () => {
      // Tenant A set một value
      await TenantContext.run(
        { tenantId: TENANT_A, tenantTier: 'basic' },
        async () => {
          await cache.set('customer', 'shared-id', { from: 'tenant-a' });
        }
      );

      // Tenant B query cùng resource + id → null (khác key prefix)
      await TenantContext.run(
        { tenantId: TENANT_B, tenantTier: 'basic' },
        async () => {
          const result = await cache.get('customer', 'shared-id');
          expect(result).toBeNull();
        }
      );
    });

    it('cache của các tenant không giao nhau sau invalidateResource', async () => {
      // Set data cho cả hai tenant
      await TenantContext.run(
        { tenantId: TENANT_A, tenantTier: 'basic' },
        async () => {
          await cache.set('deal', '1', { amount: 1000 });
          await cache.set('deal', '2', { amount: 2000 });
        }
      );

      await TenantContext.run(
        { tenantId: TENANT_B, tenantTier: 'basic' },
        async () => {
          await cache.set('deal', '1', { amount: 9999 });
        }
      );

      // Invalidate resource của Tenant A
      await TenantContext.run(
        { tenantId: TENANT_A, tenantTier: 'basic' },
        async () => {
          await cache.invalidateResource('deal');
          // Tenant A data đã xóa
          expect(await cache.get('deal', '1')).toBeNull();
          expect(await cache.get('deal', '2')).toBeNull();
        }
      );

      // Tenant B data vẫn còn
      await TenantContext.run(
        { tenantId: TENANT_B, tenantTier: 'basic' },
        async () => {
          expect(await cache.get('deal', '1')).toEqual({ amount: 9999 });
        }
      );
    });
  });
});

describe('CacheManager.flushTenant', () => {
  it('deletes all keys matching t:<tenantId>:* and rl:<tenantId>:*', async () => {
    const mockScan = vi.fn()
      .mockResolvedValueOnce(['2', ['t:abc:customer:1', 't:abc:customer:2']])
      .mockResolvedValueOnce(['0', []])
      .mockResolvedValueOnce(['0', ['rl:abc:12345']])
      .mockResolvedValueOnce(['0', []]);
    const mockDel = vi.fn().mockResolvedValue(2);
    const mockRedis = { scan: mockScan, del: mockDel, getBuffer: vi.fn(), set: vi.fn() } as any;
    const localCache = new CacheManager(mockRedis);

    await localCache.flushTenant('abc');

    expect(mockDel).toHaveBeenCalledWith('t:abc:customer:1', 't:abc:customer:2');
    expect(mockDel).toHaveBeenCalledWith('rl:abc:12345');
  });

  it('also deletes the tenant-lookup key by id', async () => {
    const mockScan = vi.fn().mockResolvedValue(['0', []]);
    const mockDel = vi.fn().mockResolvedValue(1);
    const mockRedis = { scan: mockScan, del: mockDel, getBuffer: vi.fn(), set: vi.fn() } as any;
    const localCache = new CacheManager(mockRedis);

    await localCache.flushTenant('tenant-xyz');

    expect(mockDel).toHaveBeenCalledWith('tenant-lookup:tenant-xyz');
  });
});

describe('CacheManager tenant-lookup cache', () => {
  it('setTenantLookup writes two keys (by id and by subdomain)', async () => {
    const mockSet = vi.fn().mockResolvedValue('OK');
    const mockRedis = { set: mockSet, getBuffer: vi.fn(), scan: vi.fn(), del: vi.fn() } as any;
    const localCache = new CacheManager(mockRedis);

    await localCache.setTenantLookup({
      id: 'uuid-1',
      subdomain: 'acme',
      name: 'ACME',
      tier: 'basic',
      status: 'active',
      isActive: true,
      dbUrl: null,
      allowedOrigins: [],
    });

    expect(mockSet).toHaveBeenCalledWith('tenant-lookup:uuid-1', expect.any(Buffer), 'EX', 300);
    expect(mockSet).toHaveBeenCalledWith('tenant-lookup:acme', expect.any(Buffer), 'EX', 300);
  });

  it('setTenantLookup skips subdomain key when subdomain is null', async () => {
    const mockSet = vi.fn().mockResolvedValue('OK');
    const mockRedis = { set: mockSet, getBuffer: vi.fn(), scan: vi.fn(), del: vi.fn() } as any;
    const localCache = new CacheManager(mockRedis);

    await localCache.setTenantLookup({ id: 'uuid-2', subdomain: null });

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith('tenant-lookup:uuid-2', expect.any(Buffer), 'EX', 300);
  });

  it('getTenantLookup returns null on miss', async () => {
    const mockRedis = { getBuffer: vi.fn().mockResolvedValue(null), set: vi.fn(), scan: vi.fn(), del: vi.fn() } as any;
    const localCache = new CacheManager(mockRedis);

    const result = await localCache.getTenantLookup('unknown');
    expect(result).toBeNull();
  });

  it('getTenantLookup deserializes MessagePack data on hit', async () => {
    // Use real ioredis-mock for a round-trip test
    const mod = await import('ioredis-mock');
    const IORedisMock = mod.default;
    const localRedis = new IORedisMock();
    const localCache = new CacheManager(localRedis as any);

    const tenant = { id: 'uuid-3', subdomain: 'testco', name: 'Test Co', tier: 'basic' };
    await localCache.setTenantLookup(tenant);

    const byId = await localCache.getTenantLookup('uuid-3');
    expect(byId).toEqual(tenant);

    const bySlug = await localCache.getTenantLookup('testco');
    expect(bySlug).toEqual(tenant);
  });

  it('invalidateTenantLookup deletes both id and subdomain keys', async () => {
    const mockDel = vi.fn().mockResolvedValue(2);
    const mockRedis = { del: mockDel, getBuffer: vi.fn(), set: vi.fn(), scan: vi.fn() } as any;
    const localCache = new CacheManager(mockRedis);

    await localCache.invalidateTenantLookup('uuid-4', 'myslug');

    expect(mockDel).toHaveBeenCalledWith('tenant-lookup:uuid-4', 'tenant-lookup:myslug');
  });

  it('invalidateTenantLookup deletes only id key when subdomain is null', async () => {
    const mockDel = vi.fn().mockResolvedValue(1);
    const mockRedis = { del: mockDel, getBuffer: vi.fn(), set: vi.fn(), scan: vi.fn() } as any;
    const localCache = new CacheManager(mockRedis);

    await localCache.invalidateTenantLookup('uuid-5', null);

    expect(mockDel).toHaveBeenCalledWith('tenant-lookup:uuid-5');
  });
});
