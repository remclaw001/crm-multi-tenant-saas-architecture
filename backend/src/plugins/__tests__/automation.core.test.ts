import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutomationCore } from '../cores/automation/automation.core';
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
    enabledPlugins: ['automation'],
    userId: 'user-abc',
    userRoles: [],
    requestId: 'req-xyz',
    db: { db: dbFn } as any,
    cache: {} as any,
  };
}

const mockRegistry = { register: vi.fn() };
const mockHookRegistry = { register: vi.fn(), runBefore: vi.fn(), runAfter: vi.fn() };

describe('AutomationCore', () => {
  let core: AutomationCore;

  beforeEach(() => {
    vi.clearAllMocks();
    core = new AutomationCore(mockRegistry as any, mockHookRegistry as any);
  });

  describe('onModuleInit', () => {
    it('registers itself with PluginRegistryService', () => {
      core.onModuleInit();
      expect(mockRegistry.register).toHaveBeenCalledWith(core);
    });

    it('registers before:customer.create hook handler', () => {
      core.onModuleInit();
      expect(mockHookRegistry.register).toHaveBeenCalledWith(
        'automation',
        expect.objectContaining({ event: 'customer.create', type: 'before' }),
        expect.any(Function),
      );
    });
  });

  describe('listTriggers', () => {
    it('queries automation_triggers table', async () => {
      const ctx = makeCtx();
      await core.listTriggers(ctx);
      expect(ctx.db.db).toHaveBeenCalledWith('automation_triggers');
    });
  });

  describe('getTrigger', () => {
    it('returns trigger when found', async () => {
      const row = { id: 'trig-1', name: 'Welcome' };
      const ctx = makeCtx({ first: vi.fn().mockResolvedValue(row) });
      const result = await core.getTrigger(ctx, 'trig-1');
      expect(result).toEqual(row);
    });

    it('throws ResourceNotFoundError when not found', async () => {
      const ctx = makeCtx({ first: vi.fn().mockResolvedValue(null) });
      await expect(core.getTrigger(ctx, 'missing')).rejects.toThrow(ResourceNotFoundError);
    });
  });

  describe('createTrigger', () => {
    it('inserts into automation_triggers and returns new row', async () => {
      const newTrigger = { id: 'trig-new', name: 'My trigger' };
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([newTrigger]) });
      const result = await core.createTrigger(ctx, { name: 'My trigger', event_type: 'customer.create' });
      expect(result).toEqual(newTrigger);
    });
  });

  describe('updateTrigger', () => {
    it('returns updated trigger', async () => {
      const updated = { id: 'trig-1', is_active: false };
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([updated]) });
      const result = await core.updateTrigger(ctx, 'trig-1', { is_active: false });
      expect(result).toEqual(updated);
    });

    it('throws ResourceNotFoundError when not found', async () => {
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([]) });
      await expect(core.updateTrigger(ctx, 'missing', {})).rejects.toThrow(ResourceNotFoundError);
    });
  });

  describe('deleteTrigger', () => {
    it('deletes trigger and returns void', async () => {
      const ctx = makeCtx({ del: vi.fn().mockResolvedValue(1) });
      await expect(core.deleteTrigger(ctx, 'trig-1')).resolves.toBeUndefined();
    });

    it('throws ResourceNotFoundError when not found', async () => {
      const ctx = makeCtx({ del: vi.fn().mockResolvedValue(0) });
      await expect(core.deleteTrigger(ctx, 'missing')).rejects.toThrow(ResourceNotFoundError);
    });
  });
});
