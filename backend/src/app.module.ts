// ============================================================
// AppModule — Root NestJS module
//
// Module load order (quan trọng cho DI resolution):
//   DalModule → ObservabilityModule → GatewayModule → HealthModule → ApiModule
//
// DalModule phải load đầu tiên vì:
//   - @Global() → PoolRegistry, CacheManager, KNEX_INSTANCE available everywhere
//   - PoolMetricsCollector (ObservabilityModule) injects PoolRegistry → must exist first
//
// ObservabilityModule phải load trước GatewayModule để:
//   - Pino logger sẵn sàng trước khi GatewayModule log
//   - PrometheusService sẵn sàng trước khi MetricsInterceptor (APP_INTERCEPTOR) chạy
// ============================================================
import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { config } from './config/env';
import { DalModule } from './dal/dal.module';
import { ObservabilityModule } from './observability/observability.module';
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
