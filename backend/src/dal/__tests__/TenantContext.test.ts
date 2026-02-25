import { describe, it, expect } from 'vitest';
import { TenantContext } from '../context/TenantContext';

// ============================================================
// TenantContext unit tests
//
// Điểm cốt lõi cần verify:
// 1. Hoạt động đúng bên trong run()
// 2. Không rò rỉ context ra ngoài
// 3. Isolation đúng khi chạy song song (Promise.all)
// 4. Query counter chỉ ảnh hưởng đúng context của nó
// ============================================================

describe('TenantContext', () => {
  describe('getStore / getTenantId', () => {
    it('returns undefined khi gọi ngoài context', () => {
      expect(TenantContext.getTenantId()).toBeUndefined();
      expect(TenantContext.getStore()).toBeUndefined();
      expect(TenantContext.getTier()).toBeUndefined();
    });

    it('cung cấp tenantId đúng bên trong run()', () => {
      TenantContext.run({ tenantId: 'abc-123', tenantTier: 'standard' }, () => {
        expect(TenantContext.getTenantId()).toBe('abc-123');
        expect(TenantContext.getTier()).toBe('standard');
      });
    });

    it('context không rò rỉ ra ngoài sau khi run() kết thúc', () => {
      TenantContext.run({ tenantId: 'temp', tenantTier: 'standard' }, () => undefined);
      expect(TenantContext.getTenantId()).toBeUndefined();
    });
  });

  describe('requireTenantId', () => {
    it('throw khi không có context', () => {
      expect(() => TenantContext.requireTenantId()).toThrow(
        'TenantContext: no active tenant'
      );
    });

    it('trả về tenantId khi có context', () => {
      TenantContext.run({ tenantId: 'xyz', tenantTier: 'vip' }, () => {
        expect(TenantContext.requireTenantId()).toBe('xyz');
      });
    });
  });

  describe('async isolation', () => {
    it('isolated đúng khi chạy song song', async () => {
      // Hai context chạy concurrent — phải không thấy được nhau
      const [a, b] = await Promise.all([
        TenantContext.run({ tenantId: 'tenant-a', tenantTier: 'standard' }, () =>
          new Promise<string>((resolve) =>
            // Delay dài hơn — đảm bảo thứ tự xen kẽ
            setTimeout(() => resolve(TenantContext.getTenantId()!), 20)
          )
        ),
        TenantContext.run({ tenantId: 'tenant-b', tenantTier: 'vip' }, () =>
          new Promise<string>((resolve) =>
            setTimeout(() => resolve(TenantContext.getTenantId()!), 5)
          )
        ),
      ]);

      expect(a).toBe('tenant-a');
      expect(b).toBe('tenant-b');
    });

    it('nested run() creates isolated child context', () => {
      TenantContext.run({ tenantId: 'outer', tenantTier: 'standard' }, () => {
        expect(TenantContext.getTenantId()).toBe('outer');

        TenantContext.run({ tenantId: 'inner', tenantTier: 'vip' }, () => {
          expect(TenantContext.getTenantId()).toBe('inner');
        });

        // Sau khi inner kết thúc, outer context vẫn đúng
        expect(TenantContext.getTenantId()).toBe('outer');
      });
    });
  });

  describe('query counter', () => {
    it('khởi tạo ở 0 khi bắt đầu run()', () => {
      TenantContext.run({ tenantId: 'x', tenantTier: 'standard' }, () => {
        expect(TenantContext.getQueryCount()).toBe(0);
      });
    });

    it('increment hoạt động đúng', () => {
      TenantContext.run({ tenantId: 'x', tenantTier: 'standard' }, () => {
        TenantContext.incrementQueryCount();
        TenantContext.incrementQueryCount();
        TenantContext.incrementQueryCount();
        expect(TenantContext.getQueryCount()).toBe(3);
      });
    });

    it('counter isolated giữa các context song song', async () => {
      await Promise.all([
        TenantContext.run({ tenantId: 'a', tenantTier: 'standard' }, async () => {
          TenantContext.incrementQueryCount();
          TenantContext.incrementQueryCount();
          await new Promise((r) => setTimeout(r, 10));
          // Context a không bị ảnh hưởng bởi context b
          expect(TenantContext.getQueryCount()).toBe(2);
        }),
        TenantContext.run({ tenantId: 'b', tenantTier: 'standard' }, async () => {
          TenantContext.incrementQueryCount();
          await new Promise((r) => setTimeout(r, 5));
          expect(TenantContext.getQueryCount()).toBe(1);
        }),
      ]);
    });

    it('trả về 0 khi gọi ngoài context', () => {
      expect(TenantContext.getQueryCount()).toBe(0);
    });
  });
});
