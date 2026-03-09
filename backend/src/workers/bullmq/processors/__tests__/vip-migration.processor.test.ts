import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMetadataConnect = vi.hoisted(() => vi.fn());

vi.mock('../../../../dal/pool/PoolRegistry', () => ({
  PoolRegistry: vi.fn().mockImplementation(() => ({
    acquireMetadataConnection: mockMetadataConnect,
    getSharedPool: vi.fn(),
    registerVipPool: vi.fn(),
    getVipPool: vi.fn().mockReturnValue(null),
    deregisterVipPool: vi.fn(),
  })),
}));

vi.mock('../../../../dal/pool/TenantQuotaEnforcer', () => ({
  TenantQuotaEnforcer: { deregister: vi.fn(), register: vi.fn(), reset: vi.fn() },
}));

import { VipMigrationProcessor } from '../vip-migration.processor';
import { PoolRegistry } from '../../../../dal/pool/PoolRegistry';

function makeClient(overrides: Record<string, unknown> = {}) {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn(), ...overrides };
}

describe('VipMigrationProcessor', () => {
  let processor: VipMigrationProcessor;
  let metaClient: ReturnType<typeof makeClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new VipMigrationProcessor(new PoolRegistry() as any);
    metaClient = makeClient();
    mockMetadataConnect.mockResolvedValue(metaClient);
  });

  it('rolls back to original tier on failure', async () => {
    // First CREATE DATABASE call fails
    metaClient.query.mockRejectedValueOnce(new Error('CREATE DATABASE failed'));

    const job = { data: { tenantId: 'tid', slug: 'acme', currentTier: 'premium' } } as any;
    await expect(processor.process(job)).rejects.toThrow('CREATE DATABASE failed');

    // Should have attempted rollback UPDATE
    const calls = metaClient.query.mock.calls.map((c: unknown[]) => c[0] as string);
    // Rollback UPDATE uses parameterised $1, not a literal tier value
    const hasRollback = calls.some((q: string) =>
      (q.includes('UPDATE tenants') && q.includes('tier')) || q.includes('ROLLBACK'),
    );
    expect(hasRollback).toBe(true);
  });
});
