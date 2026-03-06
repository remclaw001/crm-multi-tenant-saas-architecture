import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

const mockQuery = vi.hoisted(() => vi.fn());
const mockRelease = vi.hoisted(() => vi.fn());
const mockConnect = vi.hoisted(() => vi.fn());
const mockSign = vi.hoisted(() => vi.fn());
const mockVerify = vi.hoisted(() => vi.fn());

vi.mock('../../../../dal/pool/PoolRegistry', () => ({
  PoolRegistry: vi.fn().mockImplementation(() => ({
    getMetadataPool: () => ({
      connect: mockConnect,
    }),
  })),
}));

vi.mock('@nestjs/jwt', () => ({
  JwtService: vi.fn().mockImplementation(() => ({ sign: mockSign })),
}));

vi.mock('../../../../common/security/password.service', () => ({
  PasswordService: vi.fn().mockImplementation(() => ({ verify: mockVerify })),
}));

import { AdminAuthService } from '../admin-auth.service';
import { PoolRegistry } from '../../../../dal/pool/PoolRegistry';
import { JwtService } from '@nestjs/jwt';
import { PasswordService } from '../../../../common/security/password.service';

const SYSTEM_TENANT = { id: 'sys-t-id', subdomain: 'system' };
const ADMIN_USER = {
  id: 'admin-id', email: 'admin@crm.dev', name: 'Admin',
  password_hash: 'hash', is_active: true, roles: ['super_admin'],
};

describe('AdminAuthService', () => {
  let service: AdminAuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue({
      query: mockQuery,
      release: mockRelease,
    });
    service = new AdminAuthService(
      new (PoolRegistry as any)(),
      new (JwtService as any)(),
      new (PasswordService as any)(),
    );
  });

  it('returns token + user on valid credentials', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [SYSTEM_TENANT] })
      .mockResolvedValueOnce({ rows: [ADMIN_USER] });
    mockVerify.mockResolvedValue(true);
    mockSign.mockReturnValue('jwt-token');

    const result = await service.login({ email: 'admin@crm.dev', password: 'admin123' });

    expect(result.token).toBe('jwt-token');
    expect(result.user.email).toBe('admin@crm.dev');
    expect(result.user.role).toBe('super_admin');
  });

  it('throws UnauthorizedException when password is wrong', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [SYSTEM_TENANT] })
      .mockResolvedValueOnce({ rows: [ADMIN_USER] });
    mockVerify.mockResolvedValue(false);

    await expect(
      service.login({ email: 'admin@crm.dev', password: 'wrong' })
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when user not found', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [SYSTEM_TENANT] })
      .mockResolvedValueOnce({ rows: [] });
    mockVerify.mockResolvedValue(false);

    await expect(
      service.login({ email: 'nobody@crm.dev', password: 'x' })
    ).rejects.toThrow(UnauthorizedException);
  });
});
