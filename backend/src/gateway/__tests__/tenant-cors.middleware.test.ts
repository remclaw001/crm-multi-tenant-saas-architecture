// ============================================================
// TenantCorsMiddleware Tests — per-tenant CORS enforcement
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import { TenantCorsMiddleware } from '../middleware/tenant-cors.middleware';
import type { ResolvedTenant } from '../dto/resolved-tenant.dto';

// Helper to build a minimal mock request
function mockReq(
  origin: string | undefined,
  method = 'GET',
  resolvedTenant?: Partial<ResolvedTenant>,
): Partial<Request> & { resolvedTenant?: ResolvedTenant } {
  return {
    headers: origin ? { origin } : {},
    method,
    resolvedTenant: resolvedTenant as ResolvedTenant | undefined,
  };
}

// Helper to build a mock response with spy methods
function mockRes() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  const res = {
    setHeader: vi.fn((k: string, v: string) => { headers[k] = v; return res; }),
    status: vi.fn((code: number) => { statusCode = code; return res; }),
    end: vi.fn(() => res),
    _headers: headers,
    _status: () => statusCode,
  };
  return res as unknown as ReturnType<typeof mockRes>;
}

describe('TenantCorsMiddleware', () => {
  let mw: TenantCorsMiddleware;
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset CORS_ORIGINS env for each test
    delete process.env['CORS_ORIGINS'];
    // TenantCorsMiddleware reads config at construction — reimport or instantiate fresh
    vi.resetModules();
    mw = new TenantCorsMiddleware();
    next = vi.fn();
  });

  it('passes through when no Origin header (non-browser / same-origin)', () => {
    const req = mockReq(undefined);
    const res = mockRes();
    mw.use(req as Request, res as unknown as Response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('allows all origins in dev mode (no allowedOrigins configured)', () => {
    const req = mockReq('https://any-origin.com');
    const res = mockRes();
    mw.use(req as Request, res as unknown as Response, next);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Access-Control-Allow-Origin',
      'https://any-origin.com',
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('allows request origin matching tenant allowedOrigins', () => {
    const req = mockReq('https://app.acme.com', 'GET', {
      id: 'tid',
      allowedOrigins: ['https://app.acme.com', 'https://admin.acme.com'],
    } as Partial<ResolvedTenant>);
    const res = mockRes();
    mw.use(req as Request, res as unknown as Response, next);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Access-Control-Allow-Origin',
      'https://app.acme.com',
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('blocks request origin NOT in tenant allowedOrigins', () => {
    const req = mockReq('https://evil.com', 'GET', {
      id: 'tid',
      allowedOrigins: ['https://app.acme.com'],
    } as Partial<ResolvedTenant>);
    const res = mockRes();
    mw.use(req as Request, res as unknown as Response, next);
    // Should NOT set Access-Control-Allow-Origin
    expect(res.setHeader).not.toHaveBeenCalledWith(
      'Access-Control-Allow-Origin',
      expect.anything(),
    );
    // next() still called — browser decides based on missing CORS headers
    expect(next).toHaveBeenCalledOnce();
  });

  it('handles OPTIONS preflight: responds 204 without calling next()', () => {
    const req = mockReq('https://app.acme.com', 'OPTIONS', {
      id: 'tid',
      allowedOrigins: ['https://app.acme.com'],
    } as Partial<ResolvedTenant>);
    const res = mockRes();
    mw.use(req as Request, res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('sets Allow-Methods and Allow-Headers on preflight', () => {
    const req = mockReq('https://app.acme.com', 'OPTIONS', {
      id: 'tid',
      allowedOrigins: ['https://app.acme.com'],
    } as Partial<ResolvedTenant>);
    const res = mockRes();
    mw.use(req as Request, res as unknown as Response, next);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Access-Control-Allow-Methods',
      expect.stringContaining('POST'),
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Access-Control-Allow-Headers',
      expect.stringContaining('X-Tenant-ID'),
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Access-Control-Allow-Credentials',
      'true',
    );
  });

  it('allows wildcard preflight when no origins configured', () => {
    const req = mockReq('https://any.com', 'OPTIONS');
    const res = mockRes();
    mw.use(req as Request, res as unknown as Response, next);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Access-Control-Allow-Origin',
      'https://any.com',
    );
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('falls back to empty tenant allowedOrigins → allow all when no CORS_ORIGINS', () => {
    // resolvedTenant exists but has no allowedOrigins — should fall back to allow all
    const req = mockReq('https://other.com', 'GET', {
      id: 'tid',
      allowedOrigins: [], // empty tenant config
    } as Partial<ResolvedTenant>);
    const res = mockRes();
    mw.use(req as Request, res as unknown as Response, next);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Access-Control-Allow-Origin',
      'https://other.com',
    );
  });
});
