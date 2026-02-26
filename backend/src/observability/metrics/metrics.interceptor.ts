// ============================================================
// MetricsInterceptor — record HTTP request metrics vào Prometheus
//
// Chạy song song với LoggingInterceptor (cả hai đều là APP_INTERCEPTOR).
// Record:
//   - crm_http_requests_total     (counter)
//   - crm_http_request_duration_seconds (histogram)
//
// Route normalization:
//   Dùng req.route.path thay vì req.url để tránh cardinality explosion.
//   /api/v1/customers/123 → /api/v1/:plugin/ping (theo NestJS route definition)
//   Nếu req.route chưa set (middleware error) → fallback 'unknown'.
// ============================================================
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { PrometheusService } from './prometheus.service';
import { TenantContext } from '../../dal/context/TenantContext';

type AugmentedRequest = Request & {
  route?: { path?: string };
};

/**
 * Normalize route path cho Prometheus label.
 * Dùng Express route definition (đã có :param placeholders).
 */
function normalizeRoute(req: AugmentedRequest): string {
  // req.route.path là defined path từ NestJS controller decorator
  // e.g. ':plugin/ping' → NestJS prepend controller prefix → '/api/v1/:plugin/ping'
  const path = req.route?.path;
  if (path) return path;
  // Fallback: truncate URL để tránh high-cardinality
  const url = req.url ?? '/unknown';
  return url.split('?')[0] ?? '/unknown';
}

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly prometheus: PrometheusService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AugmentedRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    const startHr = process.hrtime.bigint();
    const tenantTier = TenantContext.getTier() ?? 'unknown';

    return next.handle().pipe(
      tap({
        next: () => this.record(req, res, startHr, tenantTier),
        error: () => this.record(req, res, startHr, tenantTier),
      })
    );
  }

  private record(
    req: AugmentedRequest,
    res: Response,
    startHr: bigint,
    tenantTier: string
  ): void {
    const durationNs = process.hrtime.bigint() - startHr;
    const durationSec = Number(durationNs) / 1e9;
    const route = normalizeRoute(req);
    const method = req.method ?? 'UNKNOWN';
    const statusCode = String(res.statusCode ?? 0);

    this.prometheus.httpRequestsTotal.inc({
      method,
      route,
      status_code: statusCode,
      tenant_tier: tenantTier,
    });

    this.prometheus.httpRequestDurationSeconds.observe(
      { method, route, tenant_tier: tenantTier },
      durationSec
    );
  }
}
