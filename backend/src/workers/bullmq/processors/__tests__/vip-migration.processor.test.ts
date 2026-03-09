import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMetadataConnect = vi.hoisted(() => vi.fn());
const mockCleanupQueueAdd = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

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

const mockCleanupQueue = { add: mockCleanupQueueAdd } as any;

function makeClient(overrides: Record<string, unknown> = {}) {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn(), ...overrides };
}

describe('VipMigrationProcessor', () => {
  let processor: VipMigrationProcessor;
  let metaClient: ReturnType<typeof makeClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new VipMigrationProcessor(new (PoolRegistry as any)(), mockCleanupQueue);
    metaClient = makeClient();
    mockMetadataConnect.mockResolvedValue(metaClient);
  });

  it('sets status=migrating at the start of process (re-gate for retries)', async () => {
    // Fail immediately after the re-gate UPDATE so we only see Step 0
    metaClient.query
      .mockResolvedValueOnce({ rows: [] })   // Step 0: UPDATE status=migrating
      .mockRejectedValueOnce(new Error('CREATE DATABASE failed')); // Step 1: fail

    const job = { data: { tenantId: 'tid', slug: 'acme', currentTier: 'premium' } } as any;
    await expect(processor.process(job)).rejects.toThrow();

    const firstCall = metaClient.query.mock.calls[0][0] as string;
    expect(firstCall).toContain('UPDATE tenants');
    expect(firstCall).toContain("status = 'migrating'");
    expect(firstCall).toContain("status != 'migrating'"); // idempotent guard
  });

  it('rolls back to original tier on failure', async () => {
    metaClient.query
      .mockResolvedValueOnce({ rows: [] })  // Step 0: re-gate
      .mockRejectedValueOnce(new Error('CREATE DATABASE failed')); // Step 1: fail

    const job = { data: { tenantId: 'tid', slug: 'acme', currentTier: 'premium' } } as any;
    await expect(processor.process(job)).rejects.toThrow('CREATE DATABASE failed');

    // Rollback UPDATE restores tier and status
    const calls = metaClient.query.mock.calls.map((c: unknown[]) => c[0] as string);
    const hasRollback = calls.some((q: string) =>
      (q.includes('UPDATE tenants') && q.includes('tier')) || q.includes('ROLLBACK'),
    );
    expect(hasRollback).toBe(true);

    // Cleanup job must NOT be enqueued on failure
    expect(mockCleanupQueueAdd).not.toHaveBeenCalled();
  });

  it('does NOT enqueue cleanup job when migration fails', async () => {
    metaClient.query
      .mockResolvedValueOnce({ rows: [] })  // Step 0: re-gate
      .mockRejectedValueOnce(new Error('schema error'));

    const job = { data: { tenantId: 'tid', slug: 'acme', currentTier: 'basic' } } as any;
    await expect(processor.process(job)).rejects.toThrow();

    expect(mockCleanupQueueAdd).not.toHaveBeenCalled();
  });
});
