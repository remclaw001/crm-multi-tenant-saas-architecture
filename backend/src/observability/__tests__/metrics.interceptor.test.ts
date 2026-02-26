// ============================================================
// MetricsInterceptor — Unit Tests
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { MetricsInterceptor } from '../metrics/metrics.interceptor';
import { PrometheusService } from '../metrics/prometheus.service';

// ── Test helpers ─────────────────────────────────────────────

function makeContext(req: Record<string, unknown>, res: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

function makeHandler(value: unknown = {}): CallHandler {
  return { handle: () => of(value) };
}

function makeErrorHandler(err: Error): CallHandler {
  return { handle: () => throwError(() => err) };
}

// ── Tests ─────────────────────────────────────────────────────
describe('MetricsInterceptor', () => {
  let prometheus: PrometheusService;
  let interceptor: MetricsInterceptor;

  beforeEach(() => {
    prometheus = new PrometheusService();
    interceptor = new MetricsInterceptor(prometheus);
  });

  afterEach(() => {
    prometheus.onModuleDestroy();
  });

  it('records metrics on successful request', async () => {
    const incSpy = vi.spyOn(prometheus.httpRequestsTotal, 'inc');
    const observeSpy = vi.spyOn(prometheus.httpRequestDurationSeconds, 'observe');

    const req = { method: 'GET', url: '/api/v1/test/ping', route: { path: '/api/v1/:plugin/ping' } };
    const res = { statusCode: 200 };
    const ctx = makeContext(req, res);

    await new Promise<void>((resolve) => {
      interceptor.intercept(ctx, makeHandler()).subscribe({ complete: resolve });
    });

    expect(incSpy).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', status_code: '200' })
    );
    expect(observeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET' }),
      expect.any(Number)
    );
  });

  it('records metrics even on error responses', async () => {
    const incSpy = vi.spyOn(prometheus.httpRequestsTotal, 'inc');

    const req = { method: 'GET', url: '/api/v1/test', route: { path: '/api/v1/:plugin/test' } };
    const res = { statusCode: 500 };
    const ctx = makeContext(req, res);

    await new Promise<void>((resolve) => {
      interceptor.intercept(ctx, makeErrorHandler(new Error('boom'))).subscribe({
        error: () => resolve(),
      });
    });

    expect(incSpy).toHaveBeenCalled();
  });

  it('uses route.path for route normalization when available', async () => {
    const incSpy = vi.spyOn(prometheus.httpRequestsTotal, 'inc');

    const req = {
      method: 'GET',
      url: '/api/v1/customers/123',   // actual URL with ID
      route: { path: '/api/v1/:plugin/ping' },  // normalized
    };
    const ctx = makeContext(req, { statusCode: 200 });

    await new Promise<void>((resolve) => {
      interceptor.intercept(ctx, makeHandler()).subscribe({ complete: resolve });
    });

    expect(incSpy).toHaveBeenCalledWith(
      expect.objectContaining({ route: '/api/v1/:plugin/ping' })
    );
  });

  it('falls back to truncated URL when route.path not set', async () => {
    const incSpy = vi.spyOn(prometheus.httpRequestsTotal, 'inc');

    const req = { method: 'GET', url: '/health' };  // no route object
    const ctx = makeContext(req, { statusCode: 200 });

    await new Promise<void>((resolve) => {
      interceptor.intercept(ctx, makeHandler()).subscribe({ complete: resolve });
    });

    expect(incSpy).toHaveBeenCalledWith(
      expect.objectContaining({ route: '/health' })
    );
  });

  it('duration is measured in seconds (positive float)', async () => {
    const observeSpy = vi.spyOn(prometheus.httpRequestDurationSeconds, 'observe');

    const ctx = makeContext(
      { method: 'GET', url: '/test' },
      { statusCode: 200 }
    );

    await new Promise<void>((resolve) => {
      interceptor.intercept(ctx, makeHandler()).subscribe({ complete: resolve });
    });

    const durationArg = (observeSpy.mock.calls[0] as [Record<string, string>, number])[1];
    expect(durationArg).toBeGreaterThanOrEqual(0);
    expect(durationArg).toBeLessThan(1); // unit test < 1 second
  });
});
