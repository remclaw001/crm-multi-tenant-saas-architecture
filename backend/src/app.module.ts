// ============================================================
// AppModule — Root NestJS module
//
// Module load order (quan trọng cho DI resolution):
//   DalModule → ObservabilityModule → SecurityModule
//   → GatewayModule → HealthModule → ApiModule
//
// DalModule phải load đầu tiên vì:
//   - @Global() → PoolRegistry, CacheManager, KNEX_INSTANCE available everywhere
//   - PoolMetricsCollector (ObservabilityModule) injects PoolRegistry → must exist first
//
// ObservabilityModule phải load trước GatewayModule để:
//   - Pino logger sẵn sàng trước khi GatewayModule log
//   - PrometheusService sẵn sàng trước khi MetricsInterceptor (APP_INTERCEPTOR) chạy
//
// SecurityModule (Phase 7) load sau ObservabilityModule để:
//   - @Global() → EncryptionService, PasswordService available everywhere
//   - Logger sẵn sàng nếu services cần log warnings (e.g. dev encryption key)
// ============================================================
import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { config } from './config/env';
import { DalModule } from './dal/dal.module';
import { ObservabilityModule } from './observability/observability.module';
import { SecurityModule } from './common/security/security.module';
import { GatewayModule } from './gateway/gateway.module';
import { HealthModule } from './health/health.module';
import { ApiModule } from './api/api.module';

@Module({
  imports: [
    // ── L4 Data Access Layer (Global singletons) ─────────────
    // PoolRegistry, CacheManager, KNEX_INSTANCE — available everywhere
    // Must load BEFORE ObservabilityModule (PoolMetricsCollector needs PoolRegistry)
    DalModule,

    // ── L7 Observability ────────────────────────────────────
    // Pino logger + OpenTelemetry + Prometheus metrics
    // Load đầu tiên để logger sẵn sàng cho mọi module sau
    ObservabilityModule,

    // ── L6 Cross-Cutting Security (Phase 7) ─────────────────
    // @Global() → EncryptionService (AES-256-GCM) + PasswordService (bcrypt)
    // Available everywhere without explicit import
    SecurityModule,

    // ── Rate limiting ────────────────────────────────────────
    ThrottlerModule.forRoot([
      {
        limit: config.THROTTLE_LIMIT,
        ttl: config.THROTTLE_TTL_MS,
      },
    ]),

    // ── L2 Gateway ───────────────────────────────────────────
    GatewayModule,

    // ── Health checks ────────────────────────────────────────
    HealthModule,

    // ── L3 API routes ────────────────────────────────────────
    ApiModule,
  ],
})
export class AppModule {}
