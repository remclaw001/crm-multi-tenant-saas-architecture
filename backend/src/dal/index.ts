// ============================================================
// DAL barrel export — L4 Data Access Layer
//
// Consumer chỉ import từ đây, không import trực tiếp từ
// sub-module để dễ refactor nội bộ sau này.
//
// Usage:
//   import { TenantContext, PoolRegistry, CacheManager } from '../dal';
// ============================================================

// Context
export { TenantContext } from './context/TenantContext';
export type { TenantStore, TenantTier } from './context/TenantContext';

// Interfaces (DIP — Phase 7 DI container wire implementation vào đây)
export type { IDbContext } from './interfaces/IDbContext';
export type { ICacheManager } from './interfaces/ICacheManager';

// Pool Registry
export { PoolRegistry } from './pool/PoolRegistry';

// Query Interceptor + Knex factory
export { applyQueryInterceptor, createKnex } from './interceptor/QueryInterceptor';

// Cache Manager
export { CacheManager } from './cache/CacheManager';

// Query Counter (middleware — Phase 6 Sandbox sẽ dùng throwOnLimit=true)
export {
  QueryCounter,
  QueryLimitExceededError,
  QUERY_LIMIT,
} from './middleware/QueryCounter';
