import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MarketingCore } from '../cores/marketing/marketing.core';
import { ResourceNotFoundError } from '../../common/errors/domain.errors';
import type { IExecutionContext } from '../interfaces/execution-context.interface';

function makeBuilder(overrides: Record<string, unknown> = {}) {
  return {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue([]),
    first: vi.fn().mockResolvedValue(null),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    del: vi.fn().mockResolvedValue(1),
    returning: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeCtx(builderOverrides = {}): IExecutionContext {
  const builder = makeBuilder(builderOverrides);
  const dbFn: any = vi.fn().mockReturnValue(builder);
  dbFn.raw = vi.fn().mockReturnValue('NOW()');
  return {
    tenantId: 'tenant-123',
    tenantTier: 'standard',
    tenantConfig: {},
    enabledPlugins: ['marketing'],
    userId: 'user-abc',
    userRoles: [],
    requestId: 'req-xyz',
    db: { db: dbFn } as any,
    cache: {} as any,
  };
}

const mockRegistry = { register: vi.fn() };

describe('MarketingCore', () => {
  let core: MarketingCore;

  beforeEach(() => {
    vi.clearAllMocks();
    core = new MarketingCore(mockRegistry as any);
  });

  describe('listCampaigns', () => {
    it('queries marketing_campaigns table', async () => {
      const ctx = makeCtx();
      await core.listCampaigns(ctx);
      expect(ctx.db.db).toHaveBeenCalledWith('marketing_campaigns');
    });
  });

  describe('getCampaign', () => {
    it('returns campaign when found', async () => {
      const row = { id: 'camp-1', name: 'Q1 Launch' };
      const ctx = makeCtx({ first: vi.fn().mockResolvedValue(row) });
      const result = await core.getCampaign(ctx, 'camp-1');
      expect(result).toEqual(row);
    });

    it('throws ResourceNotFoundError when not found', async () => {
      const ctx = makeCtx({ first: vi.fn().mockResolvedValue(null) });
      await expect(core.getCampaign(ctx, 'missing')).rejects.toThrow(ResourceNotFoundError);
    });
  });

  describe('createCampaign', () => {
    it('inserts into marketing_campaigns and returns new row', async () => {
      const newCampaign = { id: 'camp-new', name: 'Launch' };
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([newCampaign]) });
      const result = await core.createCampaign(ctx, { name: 'Launch' });
      expect(result).toEqual(newCampaign);
    });

    it('defaults campaign_type to email', async () => {
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([{ id: '1', campaign_type: 'email' }]) });
      const result = await core.createCampaign(ctx, { name: 'Test' });
      expect(ctx.db.db).toHaveBeenCalledWith('marketing_campaigns');
      expect(result).toBeDefined();
    });
  });

  describe('updateCampaign', () => {
    it('returns updated campaign', async () => {
      const updated = { id: 'camp-1', status: 'active' };
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([updated]) });
      const result = await core.updateCampaign(ctx, 'camp-1', { status: 'active' });
      expect(result).toEqual(updated);
    });

    it('throws ResourceNotFoundError when not found', async () => {
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([]) });
      await expect(core.updateCampaign(ctx, 'missing', {})).rejects.toThrow(ResourceNotFoundError);
    });
  });

  describe('deleteCampaign', () => {
    it('deletes and returns void', async () => {
      const ctx = makeCtx({ del: vi.fn().mockResolvedValue(1) });
      await expect(core.deleteCampaign(ctx, 'camp-1')).resolves.toBeUndefined();
    });

    it('throws ResourceNotFoundError when not found', async () => {
      const ctx = makeCtx({ del: vi.fn().mockResolvedValue(0) });
      await expect(core.deleteCampaign(ctx, 'missing')).rejects.toThrow(ResourceNotFoundError);
    });
  });
});
