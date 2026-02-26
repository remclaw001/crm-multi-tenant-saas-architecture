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
      useFactory: () => createKnex(config.DATABASE_URL, config.DATABASE_POOL_MAX),
    },
  ],
  exports: [PoolRegistry, CacheManager, 'KNEX_INSTANCE'],
})
export class DalModule {}
