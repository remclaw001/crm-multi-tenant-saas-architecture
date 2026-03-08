import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

const mockRedisGet = vi.hoisted(() => vi.fn());

// Must mock before import
vi.mock('@nestjs/passport', () => ({
  AuthGuard: vi.fn().mockImplementation(() => {
    return class MockAuthGuard {
      canActivate() { return true; }
      handleRequest(_err: unknown, user: unknown) { return user; }
    };
  }),
}));

import { JwtAuthGuard } from '../jwt-auth.guard';

function makeContext(user: unknown, resolvedTenant?: { id: string }, isPublic = false) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user, resolvedTenant }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard — JTI blacklist', () => {
  let guard: JwtAuthGuard;
  const redis = { get: mockRedisGet };

  beforeEach(() => {
    vi.clearAllMocks();
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(false),
    } as unknown as Reflector;
    guard = new JwtAuthGuard(reflector, redis as any);
  });

  it('passes when jti is not in blacklist', async () => {
    mockRedisGet.mockResolvedValue(null);
    const claims = { sub: 'u1', tenant_id: 't1', roles: [], jti: 'jti-ok', exp: 9999999999, iat: 0 };
    const result = await (guard as any).handleRequest(null, claims, undefined, makeContext(claims));
    expect(result.sub).toBe('u1');
    expect(mockRedisGet).toHaveBeenCalledWith('auth:blacklist:jti-ok');
  });

  it('throws UnauthorizedException when jti is in Redis blacklist', async () => {
    mockRedisGet.mockResolvedValue('1');
    const claims = { sub: 'u1', tenant_id: 't1', roles: [], jti: 'jti-revoked', exp: 9999999999, iat: 0 };
    await expect(
      (guard as any).handleRequest(null, claims, undefined, makeContext(claims))
    ).rejects.toThrow(UnauthorizedException);
  });

  it('skips blacklist check when jti is absent', async () => {
    const claims = { sub: 'u1', tenant_id: 't1', roles: [], exp: 9999999999, iat: 0 };
    const result = await (guard as any).handleRequest(null, claims, undefined, makeContext(claims));
    expect(mockRedisGet).not.toHaveBeenCalled();
    expect(result.sub).toBe('u1');
  });
});
