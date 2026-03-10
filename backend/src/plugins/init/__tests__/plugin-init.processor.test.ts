import { PluginInitProcessor, PluginInitJobData } from '../plugin-init.processor';
import { PoolRegistry } from '../../../../dal/pool/PoolRegistry';
import type { Job } from 'bullmq';

const mockQuery   = vi.hoisted(() => vi.fn());
const mockRelease = vi.hoisted(() => vi.fn());
const mockAcquire = vi.hoisted(() => vi.fn());

vi.mock('../../../../dal/pool/PoolRegistry', () => ({
  PoolRegistry: vi.fn().mockImplementation(() => ({
    acquireMetadataConnection: mockAcquire,
  })),
}));

const makeJob = (data: PluginInitJobData): Job<PluginInitJobData> => ({ data } as any);

describe('PluginInitProcessor', () => {
  let processor: PluginInitProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAcquire.mockResolvedValue({ query: mockQuery, release: mockRelease });
    processor = new PluginInitProcessor(new (PoolRegistry as any)());
  });

  it('sets initialized_at when initialized_at is null', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ initialized_at: null }] })  // SELECT
      .mockResolvedValueOnce({ rows: [] });                          // UPDATE

    await processor.process(makeJob({ tenantId: 'tid', pluginId: 'customer-data' }));

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[1][0]).toContain('SET initialized_at = NOW()');
  });

  it('returns early without UPDATE when already initialized (idempotency)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ initialized_at: '2026-03-10T00:00:00Z' }] });

    await processor.process(makeJob({ tenantId: 'tid', pluginId: 'customer-data' }));

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('throws when no prior tenant_plugins row exists (triggers BullMQ retry)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });  // SELECT returns empty

    await expect(
      processor.process(makeJob({ tenantId: 'tid', pluginId: 'analytics' })),
    ).rejects.toThrow('[PluginInit] No tenant_plugins row found');

    expect(mockQuery).toHaveBeenCalledTimes(1);  // only SELECT, no UPDATE
  });

  it.each(['customer-data', 'customer-care', 'analytics', 'automation', 'marketing'])(
    'completes without error for built-in plugin: %s',
    async (pluginId) => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ initialized_at: null }] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(
        processor.process(makeJob({ tenantId: 'tid', pluginId })),
      ).resolves.not.toThrow();
    },
  );

  it('always releases DB client even on error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'));

    await expect(
      processor.process(makeJob({ tenantId: 'tid', pluginId: 'customer-data' })),
    ).rejects.toThrow('DB error');

    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});
