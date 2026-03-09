import { AsyncLocalStorage } from 'async_hooks';

// ============================================================
// TenantContext — AsyncLocalStorage wrapper
//
// Truyền tenant context xuyên suốt call stack mà không cần
// truyền tham số thủ công qua từng function.
//
// Mọi async operation bên trong TenantContext.run() đều kế thừa
// context này — kể cả Promise chain, setTimeout, event handler.
//
// Usage:
//   await TenantContext.run({ tenantId: '...', tenantTier: 'basic' }, async () => {
//     const id = TenantContext.requireTenantId(); // 'abc-123'
//     await db.query('SELECT * FROM users'); // RLS đã biết tenant_id
//   });
// ============================================================

export type TenantTier = 'basic' | 'premium' | 'enterprise' | 'vip';

export type TenantStatus =
  | 'provisioning'
  | 'active'
  | 'migrating'
  | 'grace_period'
  | 'suspended'
  | 'offboarding'
  | 'offboarded';

export interface TenantStore {
  readonly tenantId: string;
  readonly tenantTier: TenantTier;
  /** Mutable — QueryCounter.increment() cập nhật giá trị này */
  queryCount: number;
}

const _storage = new AsyncLocalStorage<TenantStore>();

export const TenantContext = {
  /**
   * Chạy fn bên trong một async context được gắn với tenant cụ thể.
   * Tất cả code bên trong fn (kể cả async chain) đều thấy context này.
   */
  run<T>(
    store: Omit<TenantStore, 'queryCount'>,
    fn: () => T
  ): T {
    return _storage.run({ ...store, queryCount: 0 }, fn);
  },

  /** Trả về toàn bộ store, hoặc undefined nếu gọi ngoài context. */
  getStore(): TenantStore | undefined {
    return _storage.getStore();
  },

  /** Trả về tenant_id hiện tại, hoặc undefined. */
  getTenantId(): string | undefined {
    return _storage.getStore()?.tenantId;
  },

  /** Trả về tier của tenant hiện tại, hoặc undefined. */
  getTier(): TenantTier | undefined {
    return _storage.getStore()?.tenantTier;
  },

  /**
   * Trả về tenant_id, hoặc throw nếu không có context.
   * Dùng trong business logic bắt buộc phải có tenant.
   */
  requireTenantId(): string {
    const id = _storage.getStore()?.tenantId;
    if (!id) {
      throw new Error(
        'TenantContext: no active tenant — wrap the call with TenantContext.run()'
      );
    }
    return id;
  },

  /**
   * Tăng query counter cho request hiện tại.
   * Trả về giá trị sau khi tăng (dùng để kiểm tra limit).
   */
  incrementQueryCount(): number {
    const store = _storage.getStore();
    if (!store) return 0;
    store.queryCount += 1;
    return store.queryCount;
  },

  /** Số query đã thực hiện trong request hiện tại. */
  getQueryCount(): number {
    return _storage.getStore()?.queryCount ?? 0;
  },
} as const;
