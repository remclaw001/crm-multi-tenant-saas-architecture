// ============================================================
// AppModule — Root NestJS module
//
// Module load order (quan trọng cho DI resolution):
//   ObservabilityModule → GatewayModule → HealthModule → ApiModule
//
// ObservabilityModule phải load trước để:
//   - Pino logger sẵn sàng trước khi GatewayModule log
//   - PrometheusService sẵn sàng trước khi MetricsInterceptor (APP_INTERCEPTOR) chạy
// ============================================================
import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { config } from './config/env';
import { ObservabilityModule } from './observability/observability.module';
import { GatewayModule } from './gateway/gateway.module';
import { HealthModule } from './health/health.module';
import { ApiModule } from './api/api.module';

@Module({
  imports: [
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
