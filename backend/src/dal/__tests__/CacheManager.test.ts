import { describe, it, expect, beforeEach } from 'vitest';
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
