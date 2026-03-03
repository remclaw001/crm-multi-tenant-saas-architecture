import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsCore } from '../cores/analytics/analytics.core';
import type { IExecutionContext } from '../interfaces/execution-context.interface';

function makeCtx(builderOverrides: Record<string, unknown> = {}): IExecutionContext {
  const rawBuilder: any = vi.fn().mockReturnValue(undefined);
  const builder: any = {
    count: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue({ count: '5' }),
    select: vi.fn().mockReturnThis(),
    groupByRaw: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue([]),
    ...builderOverrides,
  };
  rawBuilder.raw = vi.fn().mockReturnValue('RAW_SQL');
  return {
    tenantId: 'tenant-123',
    tenantTier: 'standard',
    tenantConfig: {},
    enabledPlugins: ['analytics'],
    userId: 'user-abc',
    userRoles: [],
    requestId: 'req-xyz',
    db: { db: rawBuilder.mockReturnValue(builder), raw: vi.fn().mockReturnValue('RAW_SQL') } as any,
    cache: {} as any,
  };
}

const mockRegistry = { register: vi.fn() };

describe('AnalyticsCore', () => {
  let core: AnalyticsCore;

  beforeEach(() => {
    vi.clearAllMocks();
    core = new AnalyticsCore(mockRegistry as any);
  });

  describe('summary', () => {
    it('queries customers table (not users)', async () => {
      const ctx = makeCtx();
      await core.summary(ctx);
      expect(ctx.db.db).toHaveBeenCalledWith('customers');
      expect(ctx.db.db).not.toHaveBeenCalledWith('users');
    });

    it('returns totalCustomers and activeCustomers', async () => {
      const ctx = makeCtx({ first: vi.fn().mockResolvedValue({ count: '10' }) });
      const result = await core.summary(ctx);
      expect(result).toMatchObject({ totalCustomers: 10, activeCustomers: 10 });
    });
  });

  describe('trends', () => {
    it('queries customers table (not users)', async () => {
      const rows = [{ date: '2026-03-01', count: '3' }];
      const ctx = makeCtx({ orderBy: vi.fn().mockResolvedValue(rows) });
      await core.trends(ctx);
      expect(ctx.db.db).toHaveBeenCalledWith('customers');
    });

    it('returns array of TrendPoints with parsed count', async () => {
      const rows = [{ date: '2026-03-01', count: '3' }];
      const ctx = makeCtx({ orderBy: vi.fn().mockResolvedValue(rows) });
      const result = await core.trends(ctx);
      expect(result).toEqual([{ date: '2026-03-01', count: 3 }]);
    });
  });
});
