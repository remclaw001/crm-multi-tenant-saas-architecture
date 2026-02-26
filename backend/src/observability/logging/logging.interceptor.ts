// ============================================================
// LoggingInterceptor — structured request/response logging
//
// Thay thế @fastify/request-context plugin trong thiết kế gốc.
// Chạy SAU JWT guard → có đủ user_id, tenant_id, correlation_id.
//
// Mỗi request log:
//   ┌─ request: method, url, tenant_id, user_id, correlation_id, ip
//   └─ response: status, duration_ms, query_count (từ TenantContext)
//
// Các field trace_id / span_id được inject tự động vào Pino
// bởi @opentelemetry/instrumentation-pino — không cần thêm manual.
//
// APP_INTERCEPTOR (global) → áp dụng cho tất cả routes sau guards.
// ============================================================
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { PinoLogger } from 'nestjs-pino';
import { TenantContext } from '../../dal/context/TenantContext';
import type { JwtClaims } from '../../gateway/dto/jwt-claims.dto';
import type { ResolvedTenant } from '../../gateway/dto/resolved-tenant.dto';

type AugmentedRequest = Request & {
  correlationId?: string;
  resolvedTenant?: ResolvedTenant;
  user?: JwtClaims;
};

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: PinoLogger) {
    // Đặt context cho logger — xuất hiện trong log field "context"
    this.logger.setContext('HTTP');
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AugmentedRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    const startMs = Date.now();

    // ── Log REQUEST ────────────────────────────────────────
    this.logger.info({
      event: 'request.start',
      method: req.method,
      url: req.url,
      // Lấy từ request object (đã set bởi middleware)
      correlation_id: req.correlationId,
      tenant_id: req.resolvedTenant?.id ?? TenantContext.getTenantId(),
      tenant_tier: req.resolvedTenant?.tier ?? TenantContext.getTier(),
      user_id: req.user?.sub,
      ip: req.ip ?? req.socket?.remoteAddress,
    });

    return next.handle().pipe(
      tap({
        // ── Log RESPONSE (success) ───────────────────────
        next: () => {
          const duration = Date.now() - startMs;
          this.logger.info({
            event: 'request.complete',
            method: req.method,
            url: req.url,
            status: res.statusCode,
            duration_ms: duration,
            query_count: TenantContext.getQueryCount(),
            correlation_id: req.correlationId,
            tenant_id: req.resolvedTenant?.id ?? TenantContext.getTenantId(),
            user_id: req.user?.sub,
          });
        },

        // ── Log RESPONSE (error) ─────────────────────────
        // HttpExceptionFilter sẽ xử lý error response,
        // interceptor chỉ log timing và context
        error: (err: Error) => {
          const duration = Date.now() - startMs;
          this.logger.warn({
            event: 'request.error',
            method: req.method,
            url: req.url,
            duration_ms: duration,
            error: err.message,
            correlation_id: req.correlationId,
            tenant_id: req.resolvedTenant?.id ?? TenantContext.getTenantId(),
            user_id: req.user?.sub,
          });
        },
      })
    );
  }
}
