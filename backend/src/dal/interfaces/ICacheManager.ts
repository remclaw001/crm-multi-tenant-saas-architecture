// ============================================================
// ICacheManager — L4 abstraction over the cache layer
//
// Enforce key pattern: t:<tenantId>:<resourceType>:<id>
// Mọi operation tự động scoped theo tenant từ TenantContext.
// Business logic (L3) chỉ cần biết resource type và resource id.
//
// DIP: L3 phụ thuộc vào interface này, không phụ thuộc vào
// CacheManager cụ thể (ioredis). Phase 7 wire qua DI container.
// ============================================================

export interface ICacheManager {
  /**
   * Lấy giá trị đã cache.
   * @param resource — loại resource, e.g. 'customer', 'deal', 'tenant-config'
   * @param id — resource ID
   * @returns giá trị đã deserialize, hoặc null nếu cache miss
   */
  get<T>(resource: string, id: string): Promise<T | null>;

  /**
   * Cache một giá trị.
   * @param resource — loại resource
   * @param id — resource ID
   * @param value — giá trị cần cache (MessagePack-serialized)
   * @param ttlSeconds — thời gian sống tính bằng giây (mặc định 300)
   */
  set<T>(resource: string, id: string, value: T, ttlSeconds?: number): Promise<void>;

  /**
   * Xóa một entry khỏi cache (yêu cầu TenantContext active).
   */
  del(resource: string, id: string): Promise<void>;

  /**
   * Xóa cache entry với tenantId tường minh — không cần TenantContext.
   * Dùng cho admin routes.
   */
  delForTenant(tenantId: string, resource: string, id: string): Promise<void>;

  /**
   * Xóa tất cả entry của một resource type trong tenant hiện tại.
   * Dùng khi cần invalidate toàn bộ một collection.
   * e.g. invalidateResource('customer') → xóa t:<id>:customer:*
   */
  invalidateResource(resource: string): Promise<void>;

  /**
   * Trả về canonical cache key (dùng cho debugging/logging).
   * Pattern: t:<tenantId>:<resource>:<id>
   */
  buildKey(resource: string, id: string): string;
}
