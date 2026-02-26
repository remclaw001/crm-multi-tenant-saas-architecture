// ============================================================
// tracing.setup.ts — OpenTelemetry SDK initialization
//
// ⚠️  PHẢI được import ĐẦU TIÊN trong main.ts, trước mọi import khác.
//     Lý do: OTel monkey-patches các module (express, pg, ioredis, http).
//     Nếu những module này được import trước khi patching xảy ra,
//     instrumentation sẽ không hoạt động.
//
//     Thứ tự trong main.ts:
//       import './observability/tracing/tracing.setup';  // ← MUST BE 1ST
//       import 'reflect-metadata';
//       import { NestFactory } from '@nestjs/core';
//       ...
//
// Auto-instruments:
//   - Express (NestJS HTTP layer)
//   - pg (PostgreSQL — dùng bởi Knex và PoolRegistry)
//   - ioredis (Redis cache)
//   - http/https (outbound HTTP requests)
//   - pino (@opentelemetry/instrumentation-pino — inject trace_id vào log entries)
//
// Trace pipeline:
//   App → OTLP HTTP → Jaeger (dev) hoặc OTel Collector (prod)
// ============================================================
import 'dotenv/config';

// Đọc env trực tiếp (không qua config/env.ts để tránh circular import)
const isDisabled = process.env['OTEL_DISABLED'] === 'true' || process.env['OTEL_DISABLED'] === '1';
const serviceName = process.env['OTEL_SERVICE_NAME'] ?? 'crm-api';
const otlpEndpoint =
  process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4318/v1/traces';

if (isDisabled) {
  console.log('[OTel] Tracing disabled (OTEL_DISABLED=true)');
} else {
  // Dynamic imports để không crash khi chạy trong môi trường test
  // mà không có OTel packages (tiếp tục chạy nếu import fail)
  try {
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    const { Resource } = require('@opentelemetry/resources');
    const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } =
      require('@opentelemetry/semantic-conventions');
    const { getNodeAutoInstrumentations } =
      require('@opentelemetry/auto-instrumentations-node');

    const sdk = new NodeSDK({
      resource: new Resource({
        [ATTR_SERVICE_NAME]: serviceName,
        [ATTR_SERVICE_VERSION]: '0.1.0',
      }),

      // OTLP HTTP exporter → Jaeger / OTel Collector
      traceExporter: new OTLPTraceExporter({ url: otlpEndpoint }),

      instrumentations: [
        getNodeAutoInstrumentations({
          // Tắt instrumentation quá verbose / không cần thiết
          '@opentelemetry/instrumentation-fs': { enabled: false },
          '@opentelemetry/instrumentation-dns': { enabled: false },
          // pino instrumentation: tự động inject trace_id vào mọi log entry
          '@opentelemetry/instrumentation-pino': { enabled: true },
        }),
      ],
    });

    sdk.start();
    console.log(`[OTel] Tracing started → ${otlpEndpoint} (service: ${serviceName})`);

    // Graceful shutdown: flush pending spans trước khi process thoát
    process.on('SIGTERM', () => {
      sdk
        .shutdown()
        .then(() => console.log('[OTel] SDK shut down gracefully'))
        .catch((err: Error) => console.error('[OTel] Shutdown error:', err));
    });
  } catch (err) {
    // OTel không khả dụng — tiếp tục chạy không có tracing
    console.warn('[OTel] Could not initialize tracing:', (err as Error).message);
  }
}

/**
 * Lấy trace_id từ OpenTelemetry active span.
 * Dùng trong Pino mixin và logging contexts không tự động inject.
 *
 * Trả về undefined nếu OTel không khởi tạo hoặc không có active span.
 */
export function getActiveTraceId(): string | undefined {
  try {
    const { trace, context } = require('@opentelemetry/api');
    const span = trace.getSpan(context.active());
    if (!span) return undefined;
    const ctx = span.spanContext();
    // All-zeros trace ID = không có active span
    return ctx.traceId !== '00000000000000000000000000000000'
      ? ctx.traceId
      : undefined;
  } catch {
    return undefined;
  }
}
