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
});
