// ============================================================
// CorrelationIdMiddleware — Unit Tests
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { CorrelationIdMiddleware } from '../middleware/correlation-id.middleware';

function makeReq(headers: Record<string, string> = {}): Request & { correlationId?: string } {
  return { headers } as any;
}

function makeRes(): Response & { _headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    _headers: headers,
    setHeader: vi.fn((name: string, value: string) => { headers[name] = value; }),
  } as any;
}

describe('CorrelationIdMiddleware', () => {
  const middleware = new CorrelationIdMiddleware();

  it('generates a UUID when X-Correlation-ID header is absent', () => {
    const req = makeReq();
    const res = makeRes();
    const next: NextFunction = vi.fn();

    middleware.use(req, res, next);

    expect(req.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(next).toHaveBeenCalled();
  });

  it('reuses X-Correlation-ID from incoming header', () => {
    const incoming = 'my-upstream-trace-id';
    const req = makeReq({ 'x-correlation-id': incoming });
    const res = makeRes();
    const next: NextFunction = vi.fn();

    middleware.use(req, res, next);

    expect(req.correlationId).toBe(incoming);
  });

  it('sets X-Correlation-ID on response', () => {
    const req = makeReq();
    const res = makeRes();

    middleware.use(req, res, vi.fn());

    expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', req.correlationId);
  });

  it('each request gets a unique ID when header absent', () => {
    const req1 = makeReq();
    const req2 = makeReq();

    middleware.use(req1, makeRes(), vi.fn());
    middleware.use(req2, makeRes(), vi.fn());

    expect(req1.correlationId).not.toBe(req2.correlationId);
  });
});
