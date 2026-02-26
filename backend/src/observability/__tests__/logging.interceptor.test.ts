// ============================================================
// LoggingInterceptor — Unit Tests
//
// Test rằng logger.info() được gọi với đúng fields cho
// request.start và request.complete events.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { PinoLogger } from 'nestjs-pino';
import { LoggingInterceptor } from '../logging/logging.interceptor';

// ── Mock PinoLogger ──────────────────────────────────────────
function makeMockLogger(): PinoLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    setContext: vi.fn(),
  } as unknown as PinoLogger;
}

function makeContext(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({ statusCode: 200 }),
    }),
  } as unknown as ExecutionContext;
}

// ── Tests ─────────────────────────────────────────────────────
describe('LoggingInterceptor', () => {
  let logger: PinoLogger;
  let interceptor: LoggingInterceptor;

  beforeEach(() => {
    logger = makeMockLogger();
    interceptor = new LoggingInterceptor(logger);
  });

  it('logs request.start on intercept', async () => {
    const req = {
      method: 'GET',
      url: '/api/v1/test/ping',
      correlationId: 'corr-123',
      resolvedTenant: { id: 'tenant-111', tier: 'standard' },
      user: { sub: 'user-456' },
    };

    await new Promise<void>((resolve) => {
      interceptor.intercept(makeContext(req), { handle: () => of({}) })
        .subscribe({ complete: resolve });
    });

    const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls;
    const startLog = infoCalls.find(
      ([obj]: [Record<string, unknown>]) => obj['event'] === 'request.start'
    );
    expect(startLog).toBeDefined();
    expect(startLog[0]).toMatchObject({
      event: 'request.start',
      method: 'GET',
      url: '/api/v1/test/ping',
      correlation_id: 'corr-123',
      tenant_id: 'tenant-111',
      user_id: 'user-456',
    });
  });

  it('logs request.complete with duration and query_count on success', async () => {
    const req = {
      method: 'POST',
      url: '/api/v1/test/action',
      correlationId: 'corr-789',
    };

    await new Promise<void>((resolve) => {
      interceptor.intercept(makeContext(req), { handle: () => of({}) })
        .subscribe({ complete: resolve });
    });

    const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls;
    const completeLog = infoCalls.find(
      ([obj]: [Record<string, unknown>]) => obj['event'] === 'request.complete'
    );
    expect(completeLog).toBeDefined();
    expect(completeLog[0]).toMatchObject({
      event: 'request.complete',
      method: 'POST',
      url: '/api/v1/test/action',
    });
    expect(typeof completeLog[0]['duration_ms']).toBe('number');
    expect(typeof completeLog[0]['query_count']).toBe('number');
  });

  it('logs request.error (warn level) on error', async () => {
    const req = { method: 'GET', url: '/api/v1/fail', correlationId: 'corr-err' };

    await new Promise<void>((resolve) => {
      interceptor
        .intercept(makeContext(req), {
          handle: () => throwError(() => new Error('something failed')),
        })
        .subscribe({ error: () => resolve() });
    });

    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const errLog = warnCalls.find(
      ([obj]: [Record<string, unknown>]) => obj['event'] === 'request.error'
    );
    expect(errLog).toBeDefined();
    expect(errLog[0]).toMatchObject({
      event: 'request.error',
      error: 'something failed',
    });
  });

  it('includes correlation_id from req.correlationId', async () => {
    const req = { method: 'GET', url: '/test', correlationId: 'my-trace-id' };

    await new Promise<void>((resolve) => {
      interceptor.intercept(makeContext(req), { handle: () => of({}) })
        .subscribe({ complete: resolve });
    });

    const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls;
    const startLog = infoCalls.find(([obj]: [Record<string, unknown>]) => obj['event'] === 'request.start');
    expect(startLog?.[0]?.['correlation_id']).toBe('my-trace-id');
  });

  it('does not throw when resolvedTenant is undefined', async () => {
    const req = { method: 'GET', url: '/health' };  // no tenant

    await expect(
      new Promise<void>((resolve, reject) => {
        interceptor.intercept(makeContext(req), { handle: () => of({}) })
          .subscribe({ complete: resolve, error: reject });
      })
    ).resolves.toBeUndefined();
  });
});
