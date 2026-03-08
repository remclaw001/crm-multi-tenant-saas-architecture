// backend/src/api/v1/auth/__tests__/auth.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

// Hoisted mocks — REQUIRED: must use vi.hoisted() for variables in vi.mock() factories
const mockPoolConnect = vi.hoisted(() => vi.fn());
const mockRedisGet = vi.hoisted(() => vi.fn());
const mockRedisSetex = vi.hoisted(() => vi.fn());
const mockJwtSign = vi.hoisted(() => vi.fn().mockReturnValue('new.jwt.token'));
const mockPasswordVerify = vi.hoisted(() => vi.fn());

vi.mock('../../../dal/pool/PoolRegistry', () => ({
  PoolRegistry: vi.fn().mockImplementation(() => ({
    getMetadataPool: () => ({ connect: mockPoolConnect }),
  })),
}));

vi.mock('@nestjs/jwt', () => ({
  JwtService: vi.fn().mockImplementation(() => ({ sign: mockJwtSign })),
}));

vi.mock('../../../common/security/password.service', () => ({
  PasswordService: vi.fn().mockImplementation(() => ({ verify: mockPasswordVerify })),
}));

import { AuthService } from '../auth.service';
import { PoolRegistry } from '../../../dal/pool/PoolRegistry';
import { PasswordService } from '../../../common/security/password.service';
import { JwtService } from '@nestjs/jwt';

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    query: vi.fn(),
    release: vi.fn(),
    ...overrides,
  };
}

function makeAuthService() {
  return new AuthService(
    new PoolRegistry() as any,
    new PasswordService() as any,
    new JwtService() as any,
    { get: mockRedisGet, setex: mockRedisSetex } as any,
  );
}

describe('AuthService.login', () => {
  let service: AuthService;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeAuthService();
    client = makeClient();
    mockPoolConnect.mockResolvedValue(client);
  });

  it('returns token with jti in payload when credentials are valid', async () => {
    const tenant = { id: 't1', subdomain: 'acme', name: 'Acme', tier: 'standard' };
    const user = { id: 'u1', email: 'a@b.com', name: 'A', password_hash: '$hash', is_active: true, roles: ['admin'] };
    client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [tenant] }) // tenant lookup
      .mockResolvedValueOnce(undefined) // set_config
      .mockResolvedValueOnce({ rows: [user] }) // user lookup
      .mockResolvedValueOnce(undefined) // COMMIT
      .mockResolvedValueOnce(undefined); // INSERT refresh_token
    mockPasswordVerify.mockResolvedValue(true);

    const result = await service.login({ tenantSlug: 'acme', email: 'a@b.com', password: 'pw' });
    expect(result.token).toBe('new.jwt.token');
    // jti must be passed to jwtService.sign
    const signCall = mockJwtSign.mock.calls[0][0];
    expect(signCall).toHaveProperty('jti');
    expect(typeof signCall.jti).toBe('string');
    expect(signCall.jti.length).toBeGreaterThan(0);
  });
});

describe('AuthService.refresh', () => {
  let service: AuthService;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeAuthService();
    client = makeClient();
    mockPoolConnect.mockResolvedValue(client);
  });

  it('throws 401 when refresh token not found in DB', async () => {
    client.query.mockResolvedValue({ rows: [] });
    await expect(service.refresh('unknown-token')).rejects.toThrow(UnauthorizedException);
  });

  it('throws 401 when refresh token is revoked (revoked_at set)', async () => {
    // If query returns empty (WHERE revoked_at IS NULL filters it out)
    client.query.mockResolvedValue({ rows: [] });
    await expect(service.refresh('revoked-token')).rejects.toThrow(UnauthorizedException);
  });

  it('throws 401 when refresh token is expired', async () => {
    const past = new Date(Date.now() - 1000);
    client.query.mockResolvedValueOnce({ rows: [{ id: 'rt-1', user_id: 'u1', tenant_id: 't1', expires_at: past }] });
    await expect(service.refresh('expired-token')).rejects.toThrow(UnauthorizedException);
  });

  it('returns new access token and new refresh token on success', async () => {
    const future = new Date(Date.now() + 86400_000 * 7);
    const user = { id: 'u1', email: 'a@b.com', name: 'A', is_active: true, roles: ['admin'] };
    client.query
      .mockResolvedValueOnce({ rows: [{ id: 'rt-1', user_id: 'u1', tenant_id: 't1', expires_at: future }] })
      .mockResolvedValueOnce({ rows: [user] })
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // revoke old
      .mockResolvedValueOnce(undefined) // insert new
      .mockResolvedValueOnce(undefined); // COMMIT

    const result = await service.refresh('good-token');
    expect(result.token).toBe('new.jwt.token');
    expect(result).toHaveProperty('refreshToken');
    expect(typeof result.refreshToken).toBe('string');
    expect(result.refreshToken.length).toBe(96); // 48 bytes hex
  });
});

describe('AuthService.logout', () => {
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisSetex.mockResolvedValue('OK');
    service = makeAuthService();
  });

  it('adds JTI to Redis blacklist with remaining TTL', async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    await service.logout('jti-abc', futureExp);
    expect(mockRedisSetex).toHaveBeenCalledWith(
      'auth:blacklist:jti-abc',
      expect.any(Number),
      '1',
    );
    const ttlArg = mockRedisSetex.mock.calls[0][1] as number;
    expect(ttlArg).toBeGreaterThan(0);
    expect(ttlArg).toBeLessThanOrEqual(3600);
  });

  it('skips Redis call when token is already expired', async () => {
    const pastExp = Math.floor(Date.now() / 1000) - 10;
    await service.logout('jti-old', pastExp);
    expect(mockRedisSetex).not.toHaveBeenCalled();
  });
});
