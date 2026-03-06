import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { SuperAdminGuard } from '../super-admin.guard';
import type { JwtClaims } from '../../../../gateway/dto/jwt-claims.dto';

function makeContext(user: unknown): ExecutionContext {
  return {
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('SuperAdminGuard', () => {
  let guard: SuperAdminGuard;

  beforeEach(() => {
    guard = new SuperAdminGuard();
  });

  it('returns true when user has super_admin role', () => {
    const user: Partial<JwtClaims> = { sub: 'u1', roles: ['super_admin'] };
    expect(guard.canActivate(makeContext(user))).toBe(true);
  });

  it('throws UnauthorizedException when req.user is missing', () => {
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(UnauthorizedException);
  });

  it('throws ForbiddenException when user lacks super_admin role', () => {
    const user: Partial<JwtClaims> = { sub: 'u1', roles: ['admin'] };
    expect(() => guard.canActivate(makeContext(user))).toThrow(ForbiddenException);
  });
});
