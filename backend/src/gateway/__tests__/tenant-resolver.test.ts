// ============================================================
// TenantResolverMiddleware — Unit Tests
//
// Test không cần DB thật — mock Pool để simulate DB responses.
// Focus vào logic: header parsing, subdomain extraction, error cases.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
  HttpException,
} from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { TenantContext } from '../../dal/context/TenantContext';

// ── Mock pg.Pool ─────────────────────────────────────────────
const mockQuery = vi.hoisted(() => vi.fn());

vi.mock('pg', () => {
  const MockPool = vi.fn().mockImplementation(() => ({
    query: mockQuery,
    on: vi.fn(),
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
  }));
  return { Pool: MockPool };
});

// Import sau khi mock để tránh module cache issues
const { TenantResolverMiddleware } = await import(
  '../middleware/tenant-resolver.middleware'
);

// Helper để lấy mock query fn
function getMockQuery() {
  return mockQuery;
}

// ── Test fixtures ────────────────────────────────────────────
const activeTenantRow = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Acme Corp',
  subdomain: 'acme',
  tier: 'basic',
  status: 'active',
  db_url: null,
  is_active: true,
  config: {},
};

const inactiveTenantRow = { ...activeTenantRow, is_active: false };

function makeReq(overrides: Partial<Request> = {}): Request & { resolvedTenant?: import('../dto/resolved-tenant.dto').ResolvedTenant; correlationId?: string } {
  return {
    headers: {},
    ...overrides,
  } as any;
}

function makeRes(): Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn>; setHeader: ReturnType<typeof vi.fn> } {
  const res = {
    setHeader: vi.fn(),
    json: vi.fn(),
    status: vi.fn(),
  } as any;
  res.status.mockReturnValue(res); // allow chaining: res.status(503).json(...)
  return res;
}

// ── Tests ─────────────────────────────────────────────────────
describe('TenantResolverMiddleware', () => {
  let middleware: InstanceType<typeof TenantResolverMiddleware>;
  let next: NextFunction;

  beforeEach(() => {
    middleware = new TenantResolverMiddleware();
    next = vi.fn();
    getMockQuery().mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Tenant identifier resolution ──────────────────────────

  it('resolves tenant from X-Tenant-ID header (UUID)', async () => {
    getMockQuery().mockResolvedValueOnce({ rows: [activeTenantRow] });

    const req = makeReq({
      headers: { 'x-tenant-id': activeTenantRow.id },
    });

    await middleware.use(req, makeRes(), next);

    expect(req.resolvedTenant).toMatchObject({
      id: activeTenantRow.id,
      subdomain: 'acme',
      tier: 'basic',
    });
    expect(next).toHaveBeenCalled();
  });

  it('resolves tenant from X-Tenant-Slug header', async () => {
    getMockQuery().mockResolvedValueOnce({ rows: [activeTenantRow] });

    const req = makeReq({ headers: { 'x-tenant-slug': 'acme' } });

    await middleware.use(req, makeRes(), next);

    expect(req.resolvedTenant).toMatchObject({ subdomain: 'acme' });
  });

  it('resolves tenant from Host subdomain (acme.app.com)', async () => {
    getMockQuery().mockResolvedValueOnce({ rows: [activeTenantRow] });

    const req = makeReq({ headers: { host: 'acme.app.com' } });

    await middleware.use(req, makeRes(), next);

    expect(req.resolvedTenant).toMatchObject({ subdomain: 'acme' });
  });

  it('X-Tenant-ID header has priority over subdomain', async () => {
    getMockQuery().mockResolvedValueOnce({ rows: [activeTenantRow] });

    const req = makeReq({
      headers: {
        'x-tenant-id': activeTenantRow.id,
        host: 'other.app.com',
      },
    });

    await middleware.use(req, makeRes(), next);

    // Query phải dùng UUID lookup (isUuid = true)
    const [sql] = getMockQuery().mock.calls[0];
    expect(sql).toContain('WHERE id =');
  });

  it('X-Tenant-Slug header has priority over subdomain', async () => {
    getMockQuery().mockResolvedValueOnce({ rows: [activeTenantRow] });

    const req = makeReq({
      headers: {
        'x-tenant-slug': 'acme',
        host: 'other.app.com',
      },
    });

    await middleware.use(req, makeRes(), next);

    const [sql] = getMockQuery().mock.calls[0];
    expect(sql).toContain('WHERE subdomain =');
  });

  // ── Error cases ───────────────────────────────────────────

  it('throws 400 when no tenant identifier found', async () => {
    const req = makeReq({ headers: { host: 'localhost:3000' } });

    await expect(middleware.use(req, makeRes(), next)).rejects.toThrow(
      BadRequestException
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('throws 400 for apex domain without subdomain', async () => {
    const req = makeReq({ headers: { host: 'app.com' } });

    await expect(middleware.use(req, makeRes(), next)).rejects.toThrow(
      BadRequestException
    );
  });

  it('throws 404 when tenant not found in DB', async () => {
    getMockQuery().mockResolvedValueOnce({ rows: [] });

    const req = makeReq({ headers: { 'x-tenant-slug': 'nonexistent' } });

    await expect(middleware.use(req, makeRes(), next)).rejects.toThrow(
      NotFoundException
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('throws 403 when tenant is inactive', async () => {
    getMockQuery().mockResolvedValueOnce({ rows: [inactiveTenantRow] });

    const req = makeReq({ headers: { 'x-tenant-slug': 'acme' } });

    await expect(middleware.use(req, makeRes(), next)).rejects.toThrow(
      ForbiddenException
    );
    expect(next).not.toHaveBeenCalled();
  });

  // ── AsyncLocalStorage integration ─────────────────────────

  it('sets TenantContext when calling next()', async () => {
    getMockQuery().mockResolvedValueOnce({ rows: [activeTenantRow] });

    const req = makeReq({ headers: { 'x-tenant-slug': 'acme' } });

    let capturedTenantId: string | undefined;

    await middleware.use(req, makeRes(), () => {
      capturedTenantId = TenantContext.getTenantId();
    });

    expect(capturedTenantId).toBe(activeTenantRow.id);
  });

  it('TenantContext is NOT set after next() completes', async () => {
    getMockQuery().mockResolvedValueOnce({ rows: [activeTenantRow] });

    const req = makeReq({ headers: { 'x-tenant-slug': 'acme' } });

    await middleware.use(req, makeRes(), () => { /* noop */ });

    // Ngoài TenantContext.run() callback thì không có context
    expect(TenantContext.getTenantId()).toBeUndefined();
  });

  // ── Subdomain extraction edge cases ───────────────────────

  it('ignores www subdomain', async () => {
    const req = makeReq({ headers: { host: 'www.app.com' } });

    await expect(middleware.use(req, makeRes(), next)).rejects.toThrow(
      BadRequestException
    );
  });

  it('ignores api subdomain', async () => {
    const req = makeReq({ headers: { host: 'api.app.com' } });

    await expect(middleware.use(req, makeRes(), next)).rejects.toThrow(
      BadRequestException
    );
  });

  it('handles host with port correctly (acme.app.com:3000)', async () => {
    getMockQuery().mockResolvedValueOnce({ rows: [activeTenantRow] });

    const req = makeReq({ headers: { host: 'acme.app.com:3000' } });

    await middleware.use(req, makeRes(), next);

    expect(req.resolvedTenant).toMatchObject({ subdomain: 'acme' });
  });

  // ── Status-based enforcement ───────────────────────────────

  it('returns 503 for provisioning tenant', async () => {
    const row = { ...activeTenantRow, status: 'provisioning' };
    getMockQuery().mockResolvedValueOnce({ rows: [row] });

    const req = makeReq({ headers: { 'x-tenant-slug': 'acme' } });
    const res = makeRes();

    await middleware.use(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 503 }));
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 503 for migrating tenant', async () => {
    const row = { ...activeTenantRow, status: 'migrating' };
    getMockQuery().mockResolvedValueOnce({ rows: [row] });

    const req = makeReq({ headers: { 'x-tenant-slug': 'acme' } });
    const res = makeRes();

    await middleware.use(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('throws 401 for offboarding tenant', async () => {
    const row = { ...activeTenantRow, status: 'offboarding' };
    getMockQuery().mockResolvedValueOnce({ rows: [row] });

    const req = makeReq({ headers: { 'x-tenant-slug': 'acme' } });

    await expect(middleware.use(req, makeRes(), next)).rejects.toThrow(UnauthorizedException);
    expect(next).not.toHaveBeenCalled();
  });

  it('throws 404 for offboarded tenant', async () => {
    const row = { ...activeTenantRow, status: 'offboarded' };
    getMockQuery().mockResolvedValueOnce({ rows: [row] });

    const req = makeReq({ headers: { 'x-tenant-slug': 'acme' } });

    await expect(middleware.use(req, makeRes(), next)).rejects.toThrow(NotFoundException);
    expect(next).not.toHaveBeenCalled();
  });

  it('sets X-Billing-Warning header for grace_period tenant', async () => {
    const row = { ...activeTenantRow, status: 'grace_period' };
    getMockQuery().mockResolvedValueOnce({ rows: [row] });

    const req = makeReq({ headers: { 'x-tenant-slug': 'acme' } });
    const res = makeRes();

    await middleware.use(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Billing-Warning', expect.any(String));
    expect(next).toHaveBeenCalled();
  });

  it('throws 402 for write requests to suspended tenant', async () => {
    const row = { ...activeTenantRow, status: 'suspended' };
    getMockQuery().mockResolvedValueOnce({ rows: [row] });

    const req = makeReq({ method: 'POST', headers: { 'x-tenant-slug': 'acme' } });

    await expect(middleware.use(req, makeRes(), next)).rejects.toThrow(HttpException);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows GET for suspended tenant', async () => {
    const row = { ...activeTenantRow, status: 'suspended' };
    getMockQuery().mockResolvedValueOnce({ rows: [row] });

    const req = makeReq({ method: 'GET', headers: { 'x-tenant-slug': 'acme' } });

    await middleware.use(req, makeRes(), next);

    expect(next).toHaveBeenCalled();
  });
});
