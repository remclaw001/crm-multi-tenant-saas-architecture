// ============================================================
// JwtAuthGuard — Unit Tests
//
// Test guard logic: @Public() bypass, tenant cross-validation.
// Không cần start HTTP server — dùng NestJS Testing + mock context.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { JwtClaims } from '../dto/jwt-claims.dto';
import type { ResolvedTenant } from '../dto/resolved-tenant.dto';

// ── Test helpers ─────────────────────────────────────────────

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT_ID = '22222222-2222-2222-2222-222222222222';

function makeJwtClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: 'user-uuid-123',
    tenant_id: TENANT_ID,
    roles: ['admin'],
    iat: Math.floor(Date.now() / 1000) - 60,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

function makeResolvedTenant(overrides: Partial<ResolvedTenant> = {}): ResolvedTenant {
  return {
    id: TENANT_ID,
    subdomain: 'acme',
    name: 'Acme Corp',
    tier: 'standard',
    dbUrl: null,
    isActive: true,
    ...overrides,
  };
}

function makeExecutionContext(req: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

// ── Tests ─────────────────────────────────────────────────────
describe('JwtAuthGuard', () => {
  let reflector: Reflector;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(false),
    } as unknown as Reflector;
    guard = new JwtAuthGuard(reflector);
  });

  // ── @Public() bypass ──────────────────────────────────────

  it('returns true for @Public() routes without calling super', () => {
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const ctx = makeExecutionContext({});
    const result = guard.canActivate(ctx);

    expect(result).toBe(true);
  });

  it('checks IS_PUBLIC_KEY metadata on handler then class', () => {
    const ctx = makeExecutionContext({});
    guard.canActivate(ctx);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      IS_PUBLIC_KEY,
      [ctx.getHandler(), ctx.getClass()]
    );
  });

  // ── handleRequest: 401 cases ──────────────────────────────

  it('throws 401 when user is false (Passport auth failed)', () => {
    const ctx = makeExecutionContext({ resolvedTenant: makeResolvedTenant() });

    expect(() =>
      guard.handleRequest(null, false, undefined, ctx)
    ).toThrow(UnauthorizedException);
  });

  it('throws 401 when err is present', () => {
    const ctx = makeExecutionContext({ resolvedTenant: makeResolvedTenant() });
    const error = new Error('Token expired');

    expect(() =>
      guard.handleRequest(error, false, undefined, ctx)
    ).toThrow(UnauthorizedException);
  });

  it('throws 401 with info.message when available', () => {
    const ctx = makeExecutionContext({});

    expect(() =>
      guard.handleRequest(null, false, { message: 'jwt expired' }, ctx)
    ).toThrowError('jwt expired');
  });

  // ── handleRequest: 403 tenant mismatch ───────────────────

  it('throws 403 when JWT tenant_id does not match resolved tenant', () => {
    const req = {
      resolvedTenant: makeResolvedTenant({ id: OTHER_TENANT_ID }),
    };
    const ctx = makeExecutionContext(req);
    const user = makeJwtClaims({ tenant_id: TENANT_ID });

    expect(() =>
      guard.handleRequest(null, user as unknown as JwtClaims, undefined, ctx)
    ).toThrow(ForbiddenException);
  });

  it('throws 403 with descriptive message on mismatch', () => {
    const req = {
      resolvedTenant: makeResolvedTenant({ id: OTHER_TENANT_ID }),
    };
    const ctx = makeExecutionContext(req);
    const user = makeJwtClaims({ tenant_id: TENANT_ID });

    expect(() =>
      guard.handleRequest(null, user as unknown as JwtClaims, undefined, ctx)
    ).toThrowError(/JWT tenant mismatch/);
  });

  // ── handleRequest: happy path ─────────────────────────────

  it('returns user when JWT tenant matches resolved tenant', () => {
    const req = {
      resolvedTenant: makeResolvedTenant({ id: TENANT_ID }),
    };
    const ctx = makeExecutionContext(req);
    const user = makeJwtClaims({ tenant_id: TENANT_ID });

    const result = guard.handleRequest(null, user as unknown as JwtClaims, undefined, ctx);

    expect(result).toEqual(user);
  });

  it('returns user when no resolvedTenant on request (e.g. health routes)', () => {
    // Health routes bị exclude khỏi TenantResolverMiddleware
    // nên req.resolvedTenant sẽ undefined — guard không nên 403
    const ctx = makeExecutionContext({ resolvedTenant: undefined });
    const user = makeJwtClaims();

    const result = guard.handleRequest(null, user as unknown as JwtClaims, undefined, ctx);

    expect(result).toEqual(user);
  });
});
