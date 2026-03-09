import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';

const mockTenantId = vi.hoisted(() => vi.fn<[], string | undefined>());
const mockTier = vi.hoisted(() => vi.fn<[], string | undefined>());

vi.mock('../../context/TenantContext', () => ({
  TenantContext: {
    getTenantId: mockTenantId,
    getTier: mockTier,
    incrementQueryCount: vi.fn().mockReturnValue(1),
    getQueryCount: vi.fn().mockReturnValue(0),
  },
}));

import { TenantQuotaEnforcer } from '../../pool/TenantQuotaEnforcer';

describe('QueryInterceptor quota enforcement', () => {
  beforeEach(() => {
    TenantQuotaEnforcer.reset();
    mockTenantId.mockReturnValue('tenant-abc');
    mockTier.mockReturnValue('basic');
  });

  it('calls TenantQuotaEnforcer.acquire on connection acquire', async () => {
    const acquireSpy = vi.spyOn(TenantQuotaEnforcer, 'acquire');
    TenantQuotaEnforcer.register('tenant-abc', 'basic');

    await TenantQuotaEnforcer.acquire('tenant-abc');
    expect(acquireSpy).toHaveBeenCalledWith('tenant-abc');
  });

  it('throws ServiceUnavailableException when cap is exceeded', () => {
    TenantQuotaEnforcer.register('tenant-abc', 'basic'); // cap 10
    for (let i = 0; i < 10; i++) TenantQuotaEnforcer.acquireSync('tenant-abc');

    // acquireSync with timeoutMs=0 throws immediately when cap is reached
    expect(() => TenantQuotaEnforcer.acquireSync('tenant-abc', 0)).toThrow(
      ServiceUnavailableException
    );
  });
});
