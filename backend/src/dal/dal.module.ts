// ============================================================
// DalModule — @Global() singleton providers for L4 Data Access Layer
//
// Provides 3 singletons across the entire application:
//   PoolRegistry   — manages all DB connection pools (shared, metadata, VIP)
//   CacheManager   — ioredis wrapper with tenant-aware key pattern
//   KNEX_INSTANCE  — Knex with QueryInterceptor already applied
//
// @Global() means these are available in every module without
// explicitly importing DalModule.
//
// IMPORTANT: Import DalModule BEFORE ObservabilityModule in AppModule
// so PoolRegistry exists when PoolMetricsCollector starts.
// ============================================================
import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { config } from '../config/env';
import { PoolRegistry } from './pool/PoolRegistry';
import { CacheManager } from './cache/CacheManager';
import { createKnex } from './interceptor/QueryInterceptor';
import { TenantConfigReloadService } from './pubsub/tenant-config-reload.service';

@Global()
@Module({
  providers: [
    {
      provide: PoolRegistry,
      useFactory: () => new PoolRegistry(),
    },
    {
      provide: CacheManager,
      useFactory: () => new CacheManager(new Redis(config.REDIS_URL)),
    },
    {
      provide: 'KNEX_INSTANCE',
      // Use DATABASE_APP_URL if set — this should point to a non-superuser DB role
      // so PostgreSQL FORCE ROW LEVEL SECURITY actually applies and enforces tenant isolation.
      // Falls back to DATABASE_URL (which may be superuser, bypassing RLS).
      useFactory: () => createKnex(config.DATABASE_APP_URL ?? config.DATABASE_URL, config.DATABASE_POOL_MAX),
    },
    // Raw Redis client for auth (blacklist, refresh tokens) — shares CacheManager's connection
    {
      provide: 'REDIS_CLIENT',
      useFactory: (cm: CacheManager) => cm.client,
      inject: [CacheManager],
    },
    // Subscribes to tier-change broadcasts so every instance keeps
    // TenantQuotaEnforcer and in-process caches in sync.
    TenantConfigReloadService,
  ],
  exports: [PoolRegistry, CacheManager, 'KNEX_INSTANCE', 'REDIS_CLIENT', TenantConfigReloadService],
})
export class DalModule {}
