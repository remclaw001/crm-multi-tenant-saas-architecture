// ============================================================
// HttpExceptionFilter — chuẩn hóa error response theo RFC 7807
//
// RFC 7807 "Problem Details for HTTP APIs":
//   Content-Type: application/problem+json
//   {
//     "type":     "https://httpstatuses.io/404",
//     "title":    "Not Found",
//     "status":   404,
//     "detail":   "Tenant not found: unknown-subdomain",
//     "instance": "/api/v1/customers",
//     "traceId":  "4bf92f3577b34da6a3ce929d0e0e4736",
//     "code":     "TENANT_NOT_FOUND"  ← từ AppError subclasses
//   }
//
// Error priority (Phase 7 — L6 hierarchy):
//   1. AppError subclass   → dùng statusCode + code từ error
//   2. NestJS HttpException → dùng getStatus() + getResponse()
//   3. Unknown error        → 500 Internal Server Error
//
// 5xx errors được forward tới Sentry với tenant_id + trace_id.
// ============================================================
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from '../../common/errors/app.error';
import { PluginDependencyError } from '../../common/errors/plugin-dependency.error';
import { TenantContext } from '../../dal/context/TenantContext';
import { captureException } from '../../observability/sentry/sentry.setup';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { correlationId?: string }>();

    let status: number;
    let detail: string;
    let code: string | undefined;

    // ── Priority 1: AppError hierarchy (L6) ───────────────
    if (exception instanceof AppError) {
      status = exception.statusCode;
      detail = exception.message;
      code   = exception.code;
    }
    // ── Priority 2: NestJS HttpException ──────────────────
    else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const rawResponse = exception.getResponse();

      if (typeof rawResponse === 'string') {
        detail = rawResponse;
      } else if (rawResponse && typeof rawResponse === 'object' && 'message' in rawResponse) {
        const msg = (rawResponse as Record<string, unknown>).message;
        detail = Array.isArray(msg) ? msg.join('; ') : String(msg);
      } else {
        detail = exception.message;
      }
    }
    // ── Priority 3: Unknown / unhandled error ──────────────
    else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      detail = exception instanceof Error
        ? exception.message
        : 'An unexpected error occurred';
    }

    // ── RFC 7807 Problem Details payload ──────────────────
    const problemDetails: Record<string, unknown> = {
      type:     `https://httpstatuses.io/${status}`,
      title:    HttpStatus[status]?.replace(/_/g, ' ') ?? 'Error',
      status,
      detail,
      instance: req.url,
      traceId:  req.correlationId ?? 'unknown',
    };

    // code field: only for AppError subclasses (machine-readable)
    if (code !== undefined) {
      problemDetails['code'] = code;
    }

    // PluginDependencyError: include missingDeps / blockingDependents in RFC 7807 body
    if (exception instanceof PluginDependencyError) {
      if (exception.missingDeps.length > 0) {
        problemDetails['missingDeps'] = exception.missingDeps;
      }
      if (exception.blockingDependents.length > 0) {
        problemDetails['blockingDependents'] = exception.blockingDependents;
      }
    }

    // ── 5xx: log + forward to Sentry ──────────────────────
    if (status >= 500) {
      const tenantId = TenantContext.getStore()?.tenantId;
      const traceId  = req.correlationId;

      console.error('[HttpExceptionFilter]', {
        status,
        code,
        detail,
        tenantId,
        correlationId: traceId,
        url: req.url,
        method: req.method,
        stack: exception instanceof Error ? exception.stack : undefined,
      });

      captureException(exception, { tenantId, traceId });
    }

    res
      .status(status)
      .setHeader('Content-Type', 'application/problem+json')
      .json(problemDetails);
  }
}
