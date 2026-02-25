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
//     "traceId":  "4bf92f3577b34da6a3ce929d0e0e4736"  // correlation ID
//   }
//
// Thay thế cho Fastify setErrorHandler từ thiết kế gốc.
// Tương thích với NestJS HttpException hierarchy.
// ============================================================
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { correlationId?: string }>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const rawResponse =
      exception instanceof HttpException
        ? exception.getResponse()
        : null;

    // Extract detail message
    let detail: string;
    if (typeof rawResponse === 'string') {
      detail = rawResponse;
    } else if (rawResponse && typeof rawResponse === 'object' && 'message' in rawResponse) {
      const msg = (rawResponse as Record<string, unknown>).message;
      detail = Array.isArray(msg) ? msg.join('; ') : String(msg);
    } else if (exception instanceof Error) {
      detail = exception.message;
    } else {
      detail = 'An unexpected error occurred';
    }

    const problemDetails = {
      type: `https://httpstatuses.io/${status}`,
      title: HttpStatus[status]?.replace(/_/g, ' ') ?? 'Error',
      status,
      detail,
      instance: req.url,
      traceId: req.correlationId ?? 'unknown',
    };

    // Log 5xx errors (4xx đã expected — không cần log ở đây)
    if (status >= 500) {
      console.error('[HttpExceptionFilter]', {
        status,
        detail,
        stack: exception instanceof Error ? exception.stack : undefined,
        correlationId: req.correlationId,
        url: req.url,
        method: req.method,
      });
    }

    res
      .status(status)
      .setHeader('Content-Type', 'application/problem+json')
      .json(problemDetails);
  }
}
