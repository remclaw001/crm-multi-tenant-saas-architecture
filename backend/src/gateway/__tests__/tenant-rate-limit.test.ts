// ============================================================
// TenantRateLimitMiddleware Tests
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import { TenantRateLimitMiddleware } from '../middleware/tenant-rate-limit.middleware';
import type { ResolvedTenant } from '../dto/resolved-tenant.dto';

// ── Helpers ──────────────────────────────────────────────────

function buildTenant(tier: string, id = 'tenant-uuid-001'): ResolvedTenant {
  return {
    id,
    subdomain: 'acme',
    name: 'Acme Corp',
    tier: tier as ResolvedTenant['tier'],
    status: 'active',
    dbUrl: null,
    isActive: true,
    allowedOrigins: [],
  };
}

function mockReq(resolvedTenant?: ResolvedTenant): Request & { resolvedTenant?: ResolvedTenant } {
  return {
    headers: {},
    method: 'GET',
    resolvedTenant,
  } as unknown as Request & { resolvedTenant?: ResolvedTenant };
}

function mockRes() {
  let _statusCode = 200;
  let _body: unknown;
  const res = {
    status: vi.fn((code: number) => { _statusCode = code; return res; }),
    json: vi.fn((body: unknown) => { _body = body; return res; }),
    _status: () => _statusCode,
    _body: () => _body,
  };
  return res;
}

// ── Redis mock factory ────────────────────────────────────────

function buildCacheMock(incrReturn: number) {
  const redis = {
    incr: vi.fn().mockResolvedValue(incrReturn),
    expire: vi.fn().mockResolvedValue(1),
  };
  return {
    client: redis,
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('TenantRateLimitMiddleware', () => {
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn();
  });

  // ─── No tenant (public route) ────────────────────────────

  it('calls next() immediately when no resolvedTenant on request', async () => {
    const cache = buildCacheMock(1);
    const mw = new TenantRateLimitMiddleware(cache as never);
    const req = mockReq(undefined);
    const res = mockRes();

    await mw.use(req as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(cache.client.incr).not.toHaveBeenCalled();
  });

  // ─── VIP: skip rate limiting entirely ────────────────────

  it('calls next() without hitting Redis for VIP tenants', async () => {
    const cache = buildCacheMock(1);
    const mw = new TenantRateLimitMiddleware(cache as never);
    const req = mockReq(buildTenant('vip'));
    const res = mockRes();

    await mw.use(req as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(cache.client.incr).not.toHaveBeenCalled();
  });

  // ─── Within limit: calls next() ──────────────────────────

  it('calls next() when request count is within basic tier limit (100)', async () => {
    const cache = buildCacheMock(50); // well within 100
    const mw = new TenantRateLimitMiddleware(cache as never);
    const req = mockReq(buildTenant('basic'));
    const res = mockRes();

    await mw.use(req as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('calls next() when request count is exactly at basic tier limit (100)', async () => {
    const cache = buildCacheMock(100); // exactly at limit — should still pass
    const mw = new TenantRateLimitMiddleware(cache as never);
    const req = mockReq(buildTenant('basic'));
    const res = mockRes();

    await mw.use(req as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  // ─── Exceeded limit: returns 429 ─────────────────────────

  it('returns 429 when basic tenant exceeds 100 requests', async () => {
    const cache = buildCacheMock(101); // over the limit
    const mw = new TenantRateLimitMiddleware(cache as never);
    const req = mockReq(buildTenant('basic'));
    const res = mockRes();

    await mw.use(req as Request, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({ statusCode: 429, message: 'Rate limit exceeded' });
  });

  it('returns 429 when standard tenant exceeds 100 requests', async () => {
    const cache = buildCacheMock(200);
    const mw = new TenantRateLimitMiddleware(cache as never);
    const req = mockReq(buildTenant('standard'));
    const res = mockRes();

    await mw.use(req as Request, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('does NOT return 429 for premium tenant at 101 requests (limit=500)', async () => {
    const cache = buildCacheMock(101); // within premium limit of 500
    const mw = new TenantRateLimitMiddleware(cache as never);
    const req = mockReq(buildTenant('premium'));
    const res = mockRes();

    await mw.use(req as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 429 for premium tenant over 500 requests', async () => {
    const cache = buildCacheMock(501);
    const mw = new TenantRateLimitMiddleware(cache as never);
    const req = mockReq(buildTenant('premium'));
    const res = mockRes();

    await mw.use(req as Request, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('does NOT return 429 for enterprise tenant at 1500 requests (limit=2000)', async () => {
    const cache = buildCacheMock(1500);
    const mw = new TenantRateLimitMiddleware(cache as never);
    const req = mockReq(buildTenant('enterprise'));
    const res = mockRes();

    await mw.use(req as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 429 for enterprise tenant over 2000 requests', async () => {
    const cache = buildCacheMock(2001);
    const mw = new TenantRateLimitMiddleware(cache as never);
    const req = mockReq(buildTenant('enterprise'));
    const res = mockRes();

    await mw.use(req as Request, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });

  // ─── Redis key format ─────────────────────────────────────

  it('uses correct Redis key format: rl:{tenantId}:{minuteBucket}', async () => {
    const cache = buildCacheMock(1);
    const mw = new TenantRateLimitMiddleware(cache as never);
    const tenant = buildTenant('basic', 'my-tenant-id');
    const req = mockReq(tenant);
    const res = mockRes();

    const beforeMinute = Math.floor(Date.now() / 60_000);
    await mw.use(req as Request, res as unknown as Response, next);
    const afterMinute = Math.floor(Date.now() / 60_000);

    const calledKey: string = cache.client.incr.mock.calls[0][0] as string;
    // Key must start with rl:my-tenant-id: and end with correct minute bucket
    expect(calledKey).toMatch(/^rl:my-tenant-id:\d+$/);
    const bucket = parseInt(calledKey.split(':')[2], 10);
    expect(bucket).toBeGreaterThanOrEqual(beforeMinute);
    expect(bucket).toBeLessThanOrEqual(afterMinute);
  });

  // ─── TTL set only on first request in bucket ─────────────

  it('sets EXPIRE 60 when INCR returns 1 (first request in bucket)', async () => {
    const cache = buildCacheMock(1);
    const mw = new TenantRateLimitMiddleware(cache as never);
    const req = mockReq(buildTenant('basic'));
    const res = mockRes();

    await mw.use(req as Request, res as unknown as Response, next);

    expect(cache.client.expire).toHaveBeenCalledWith(expect.any(String), 60);
  });

  it('does NOT call EXPIRE when INCR returns > 1 (bucket already exists)', async () => {
    const cache = buildCacheMock(5); // not the first request
    const mw = new TenantRateLimitMiddleware(cache as never);
    const req = mockReq(buildTenant('basic'));
    const res = mockRes();

    await mw.use(req as Request, res as unknown as Response, next);

    expect(cache.client.expire).not.toHaveBeenCalled();
  });

  // ─── Unknown tier falls back to 100 ─────────────────────

  it('falls back to limit 100 for unknown tier', async () => {
    const cache = buildCacheMock(101);
    const mw = new TenantRateLimitMiddleware(cache as never);
    const req = mockReq(buildTenant('unknown-tier-xyz'));
    const res = mockRes();

    await mw.use(req as Request, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });
});
