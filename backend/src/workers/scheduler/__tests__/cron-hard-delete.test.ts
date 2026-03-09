import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CronService } from '../cron.service';

describe('CronService.hardDeleteOffboardedTenants', () => {
  let service: CronService;
  let mockQuery: ReturnType<typeof vi.fn>;
  let mockRelease: ReturnType<typeof vi.fn>;
  let mockPoolRegistry: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery = vi.fn();
    mockRelease = vi.fn();
    mockPoolRegistry = {
      acquireMetadataConnection: vi.fn().mockResolvedValue({ query: mockQuery, release: mockRelease }),
    };
    service = new CronService(
      { getWaitingCount: vi.fn(), getFailedCount: vi.fn() } as any,
      { getWaitingCount: vi.fn(), getFailedCount: vi.fn() } as any,
      mockPoolRegistry,
    );
  });

  it('deletes plugin data for tenants offboarded 90+ days ago', async () => {
    // First query: find tenants
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'tid-1' }, { id: 'tid-2' }] });
    // Subsequent queries: DELETE statements
    mockQuery.mockResolvedValue({ rows: [] });

    await (service as any).hardDeleteOffboardedTenants();

    const calls = mockQuery.mock.calls.map((c: unknown[][]) => c[0] as string);
    expect(calls[0]).toContain("status = 'offboarded'");
    expect(calls[0]).toContain('90 days');

    const deleteCalls = calls.filter((q: string) => q.includes('DELETE'));
    expect(deleteCalls.length).toBeGreaterThan(0);
  });

  it('does nothing when no tenants qualify', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await (service as any).hardDeleteOffboardedTenants();

    expect(mockQuery).toHaveBeenCalledTimes(1); // only the SELECT
  });
});
