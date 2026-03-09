import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAcquire = vi.hoisted(() => vi.fn());

vi.mock('../../../../dal/pool/PoolRegistry', () => ({
  PoolRegistry: vi.fn().mockImplementation(() => ({
    acquireMetadataConnection: mockAcquire,
  })),
}));

import { VipSharedCleanupProcessor } from '../vip-shared-cleanup.processor';
import { PoolRegistry } from '../../../../dal/pool/PoolRegistry';

function makeClient(rowCount = 3) {
  return {
    query:   vi.fn().mockResolvedValue({ rows: [], rowCount }),
    release: vi.fn(),
  };
}

describe('VipSharedCleanupProcessor', () => {
  let processor: VipSharedCleanupProcessor;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new VipSharedCleanupProcessor(new (PoolRegistry as any)());
    client = makeClient();
    mockAcquire.mockResolvedValue(client);
  });

  it('deletes all 4 plugin tables for the given tenant', async () => {
    const job = { data: { tenantId: 'tid-1', slug: 'acme' } } as any;
    await processor.process(job);

    const tables = client.query.mock.calls
      .map((c: unknown[]) => c[0] as string)
      .filter((q: string) => q.startsWith('DELETE'));

    expect(tables).toHaveLength(4);
    expect(tables.some((q: string) => q.includes('customers'))).toBe(true);
    expect(tables.some((q: string) => q.includes('support_cases'))).toBe(true);
    expect(tables.some((q: string) => q.includes('automation_triggers'))).toBe(true);
    expect(tables.some((q: string) => q.includes('marketing_campaigns'))).toBe(true);
  });

  it('passes tenantId as parameter to every DELETE', async () => {
    const job = { data: { tenantId: 'tid-1', slug: 'acme' } } as any;
    await processor.process(job);

    const deleteCalls = client.query.mock.calls.filter(
      (c: unknown[]) => (c[0] as string).startsWith('DELETE'),
    );
    for (const call of deleteCalls) {
      expect(call[1]).toEqual(['tid-1']);
    }
  });

  it('releases the connection even if a DELETE throws', async () => {
    client.query.mockRejectedValueOnce(new Error('DB error'));
    const job = { data: { tenantId: 'tid-1', slug: 'acme' } } as any;

    await expect(processor.process(job)).rejects.toThrow('DB error');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
