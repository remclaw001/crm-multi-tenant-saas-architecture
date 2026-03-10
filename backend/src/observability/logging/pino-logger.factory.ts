// ============================================================
// pino-logger.factory.ts — Cấu hình nestjs-pino
//
// Trả về Params object để truyền vào LoggerModule.forRoot().
//
// Mỗi log entry tự động có:
//   tenant_id  — từ TenantContext (AsyncLocalStorage)
//   trace_id   — inject tự động bởi @opentelemetry/instrumentation-pino
//   span_id    — inject tự động bởi @opentelemetry/instrumentation-pino
//
// Request-scoped fields (chỉ có trong HTTP logs):
//   correlation_id — từ req.correlationId (CorrelationIdMiddleware)
//
// NOTE: user_id được log bởi LoggingInterceptor sau khi JWT guard verify,
// không có ở đây vì JWT chưa được verify tại thời điểm request đến.
//
// Transport:
//   development → pino-pretty (human-readable)
//   production  → raw JSON (ingest vào Grafana Loki)
// ============================================================
import type { Params } from 'nestjs-pino';
import { TenantContext } from '../../dal/context/TenantContext';
import { config } from '../../config/env';

export function buildPinoOptions(): Params {
  return {
    pinoHttp: {
      // Log level từ env (default: info)
      level: config.LOG_LEVEL,

      // autoLogging: false — tắt pino-http request/response logging tự động
      // LoggingInterceptor sẽ log sau khi JWT guard chạy (có đủ user_id + tenant context)
      autoLogging: false,

      // mixin() — gắn thêm fields vào MỌI log entry
      // Được gọi synchronously trong ngữ cảnh của log statement
      // → AsyncLocalStorage vẫn hoạt động ở đây
      mixin() {
        const tenantId = TenantContext.getTenantId();
        const tier = TenantContext.getTier();
        return {
          // tenant_id: undefined nếu gọi ngoài request context (e.g. startup logs)
          ...(tenantId ? { tenant_id: tenantId } : {}),
          ...(tier ? { tenant_tier: tier } : {}),
          // trace_id và span_id được inject tự động bởi:
          // @opentelemetry/instrumentation-pino (không cần thêm ở đây)
        };
      },

      // customProps(req) — thêm fields từ request object
      // Được gọi một lần khi request bắt đầu để tạo child logger
      customProps(req: import('http').IncomingMessage) {
        return {
          correlation_id: (req as unknown as Record<string, unknown>)['correlationId'] ?? undefined,
        };
      },

      // Serializers — kiểm soát cách request/response được log
      // (chủ yếu relevant khi autoLogging: true, giữ đây để dùng nếu cần)
      serializers: {
        req(req: Record<string, unknown>) {
          return {
            method: req['method'],
            url: req['url'],
            remoteAddress: (req['socket'] as Record<string, unknown>)?.['remoteAddress'],
          };
        },
        res(res: Record<string, unknown>) {
          return { statusCode: res['statusCode'] };
        },
      },

      // Transport: pretty print trong development
      ...(config.NODE_ENV === 'development'
        ? {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                singleLine: true,
                ignore: 'pid,hostname',
                translateTime: 'HH:MM:ss.l',
              },
            },
          }
        : {}),
    },
  };
}
