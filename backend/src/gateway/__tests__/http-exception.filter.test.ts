// ============================================================
// HttpExceptionFilter — Unit Tests
//
// Verify RFC 7807 Problem Details response format.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { HttpException, HttpStatus, ArgumentsHost } from '@nestjs/common';
import { HttpExceptionFilter } from '../filters/http-exception.filter';

// ── Test helpers ─────────────────────────────────────────────

function makeHost(
  req: Record<string, unknown>,
  res: Record<string, unknown>
): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ArgumentsHost;
}

function makeRes(): Record<string, unknown> & { json: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn>; setHeader: ReturnType<typeof vi.fn> } {
  const res = {
    status: vi.fn(),
    setHeader: vi.fn(),
    json: vi.fn(),
  };
  // Allow chaining: res.status(x).setHeader(y).json(z)
  res.status.mockReturnValue(res);
  res.setHeader.mockReturnValue(res);
  return res;
}

// ── Tests ─────────────────────────────────────────────────────
import {
  TenantNotFoundError,
  PluginTimeoutError,
  PluginDisabledError,
  ConflictError,
  PluginDependencyError,
} from '../../common/errors';

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  it('returns correct status for 404 HttpException', () => {
    const exception = new HttpException('Tenant not found: acme', HttpStatus.NOT_FOUND);
    const res = makeRes();
    const req = { url: '/api/v1/customers', correlationId: 'test-correlation-id' };

    filter.catch(exception, makeHost(req, res));

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('sets Content-Type to application/problem+json', () => {
    const exception = new HttpException('Not found', HttpStatus.NOT_FOUND);
    const res = makeRes();

    filter.catch(exception, makeHost({ url: '/', correlationId: 'x' }, res));

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/problem+json'
    );
  });

  it('response body follows RFC 7807 shape', () => {
    const exception = new HttpException('Tenant not found: acme', HttpStatus.NOT_FOUND);
    const res = makeRes();
    const req = { url: '/api/v1/customers', correlationId: 'abc-123' };

    filter.catch(exception, makeHost(req, res));

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body).toMatchObject({
      type: 'https://httpstatuses.io/404',
      title: 'NOT FOUND',
      status: 404,
      detail: 'Tenant not found: acme',
      instance: '/api/v1/customers',
      traceId: 'abc-123',
    });
  });

  it('returns 500 for unexpected (non-HttpException) errors', () => {
    const error = new Error('Database connection refused');
    const res = makeRes();

    filter.catch(error, makeHost({ url: '/', correlationId: 'x' }, res));

    expect(res.status).toHaveBeenCalledWith(500);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.status).toBe(500);
    expect(body.detail).toBe('Database connection refused');
  });

  it('handles string message HttpException', () => {
    const exception = new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    const res = makeRes();

    filter.catch(exception, makeHost({ url: '/', correlationId: 'x' }, res));

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.status).toBe(403);
    expect(body.detail).toBe('Forbidden');
  });

  it('handles object message with array (validation errors)', () => {
    const exception = new HttpException(
      { message: ['email must be an email', 'name must not be empty'], error: 'Bad Request' },
      HttpStatus.BAD_REQUEST
    );
    const res = makeRes();

    filter.catch(exception, makeHost({ url: '/', correlationId: 'x' }, res));

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.detail).toBe('email must be an email; name must not be empty');
  });

  it('uses "unknown" traceId when correlationId not set', () => {
    const exception = new HttpException('error', HttpStatus.BAD_REQUEST);
    const res = makeRes();

    filter.catch(exception, makeHost({ url: '/' }, res));

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.traceId).toBe('unknown');
  });

  // ── AppError hierarchy (Phase 7) ────────────────────────────

  it('maps TenantNotFoundError → 404 with code field', () => {
    const exception = new TenantNotFoundError('acme');
    const res = makeRes();
    filter.catch(exception, makeHost({ url: '/api/v1', correlationId: 'x' }, res));

    expect(res.status).toHaveBeenCalledWith(404);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.status).toBe(404);
    expect(body.code).toBe('TENANT_NOT_FOUND');
    expect(body.detail).toContain('acme');
  });

  it('maps PluginTimeoutError → 504 with code field', () => {
    const exception = new PluginTimeoutError('analytics', 5000);
    const res = makeRes();
    filter.catch(exception, makeHost({ url: '/api/v1', correlationId: 'x' }, res));

    expect(res.status).toHaveBeenCalledWith(504);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.status).toBe(504);
    expect(body.code).toBe('PLUGIN_TIMEOUT');
  });

  it('maps PluginDisabledError → 403 with code PLUGIN_DISABLED', () => {
    const exception = new PluginDisabledError('marketing');
    const res = makeRes();
    filter.catch(exception, makeHost({ url: '/api/v1', correlationId: 'x' }, res));

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.status).toBe(403);
    expect(body.code).toBe('PLUGIN_DISABLED');
  });

  it('maps ConflictError → 409 with code CONFLICT', () => {
    const exception = new ConflictError('Email already exists');
    const res = makeRes();
    filter.catch(exception, makeHost({ url: '/api/v1', correlationId: 'x' }, res));

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.status).toBe(409);
    expect(body.code).toBe('CONFLICT');
    expect(body.detail).toBe('Email already exists');
  });

  it('maps PluginDependencyError with missingDeps → 422 with missingDeps array and code PLUGIN_DEPENDENCY_VIOLATION', () => {
    const exception = new PluginDependencyError('customer-care', 'enable', ['customer-data'], []);
    const res = makeRes();
    filter.catch(exception, makeHost({ url: '/api/v1', correlationId: 'x' }, res));

    expect(res.status).toHaveBeenCalledWith(422);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.status).toBe(422);
    expect(body.code).toBe('PLUGIN_DEPENDENCY_VIOLATION');
    expect(body.missingDeps).toEqual(['customer-data']);
    expect(body.blockingDependents).toBeUndefined();
  });

  it('maps PluginDependencyError with blockingDependents → 422 with blockingDependents array', () => {
    const exception = new PluginDependencyError('customer-data', 'disable', [], ['customer-care', 'automation']);
    const res = makeRes();
    filter.catch(exception, makeHost({ url: '/api/v1', correlationId: 'x' }, res));

    expect(res.status).toHaveBeenCalledWith(422);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.status).toBe(422);
    expect(body.blockingDependents).toEqual(['customer-care', 'automation']);
    expect(body.missingDeps).toBeUndefined();
  });

  it('does not set code field for NestJS HttpException', () => {
    const exception = new HttpException('not found', HttpStatus.NOT_FOUND);
    const res = makeRes();
    filter.catch(exception, makeHost({ url: '/', correlationId: 'x' }, res));

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.code).toBeUndefined();
  });

  it('AppError response includes RFC 7807 required fields', () => {
    const exception = new TenantNotFoundError('beta');
    const res = makeRes();
    filter.catch(exception, makeHost({ url: '/api/v1', correlationId: 'trace-abc' }, res));

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body).toHaveProperty('type');
    expect(body).toHaveProperty('title');
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('detail');
    expect(body).toHaveProperty('instance');
    expect(body).toHaveProperty('traceId', 'trace-abc');
    expect(body).toHaveProperty('code', 'TENANT_NOT_FOUND');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/problem+json');
  });
});
