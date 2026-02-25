// ============================================================
// CorrelationIdMiddleware — generate/propagate request correlation ID
//
// Mỗi request nhận một UUID v4 duy nhất (hoặc reuse từ header
// X-Correlation-ID nếu client gửi lên — hữu ích cho distributed tracing).
//
// UUID được:
//   1. Gắn vào req.correlationId (để dùng trong controller/guard/filter)
//   2. Trả về trong response header X-Correlation-ID (để client trace)
//
// Chạy TRƯỚC TenantResolverMiddleware trong middleware chain.
// ============================================================
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request & { correlationId?: string }, res: Response, next: NextFunction): void {
    // Reuse nếu client gửi lên (e.g. từ API gateway ở trên)
    const incoming = req.headers['x-correlation-id'];
    const correlationId =
      typeof incoming === 'string' && incoming.length > 0
        ? incoming
        : randomUUID();

    req.correlationId = correlationId;
    res.setHeader('X-Correlation-ID', correlationId);

    next();
  }
}
