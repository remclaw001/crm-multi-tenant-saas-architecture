// ============================================================
// ObservabilityModule — L7 Observability
//
// Cung cấp:
//   Logging  → nestjs-pino (Pino logger với tenant/trace enrichment)
//   Tracing  → OpenTelemetry (khởi tạo trong tracing.setup.ts, chạy trước module này)
//   Metrics  → prom-client (Prometheus exposition format tại GET /metrics)
//
// Export PrometheusService để modules khác (CacheManager wrapper ở Phase 7)
// có thể record cache metrics.
// ============================================================
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { buildPinoOptions } from './logging/pino-logger.factory';
import { LoggingInterceptor } from './logging/logging.interceptor';
import { PrometheusService } from './metrics/prometheus.service';
import { MetricsInterceptor } from './metrics/metrics.interceptor';
import { MetricsController } from './metrics/metrics.controller';
import { PoolMetricsCollector } from './metrics/pool-metrics.collector';

@Module({
  imports: [
    // ── Pino Logger ─────────────────────────────────────────
    // LoggerModule.forRoot() cấu hình nestjs-pino:
    //   - Pino instance với mixin (tenant_id) + customProps (correlation_id)
    //   - autoLogging: false — LoggingInterceptor xử lý req/res logs
    //   - pino-pretty trong development, raw JSON trong production
    LoggerModule.forRoot(buildPinoOptions()),
  ],
  controllers: [
    // GET /metrics — Prometheus scrape endpoint
    MetricsController,
  ],
  providers: [
    // ── Prometheus Service ───────────────────────────────────
    PrometheusService,

    // ── Pool Metrics Collector ───────────────────────────────
    // Cập nhật DB pool gauges định kỳ (15s interval)
    PoolMetricsCollector,

    // ── Global Interceptors (APP_INTERCEPTOR) ────────────────
    // Thứ tự: LoggingInterceptor chạy trước MetricsInterceptor
    // (logging có priority cao hơn để đảm bảo log ngay cả khi metrics fail)
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: MetricsInterceptor,
    },
  ],
  exports: [
    // Export để modules khác dùng PrometheusService record metrics
    PrometheusService,
  ],
})
export class ObservabilityModule {}
