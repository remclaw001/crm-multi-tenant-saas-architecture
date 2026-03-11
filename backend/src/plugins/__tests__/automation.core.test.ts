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
    tenantTier: 'basic',
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

    it('registers after:customer.create hook handler with priority 20', () => {
      core.onModuleInit();
      expect(mockHookRegistry.register).toHaveBeenCalledWith(
        'automation',
        expect.objectContaining({ event: 'customer.create', type: 'after', priority: 20 }),
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

  describe('fireTriggerEvents', () => {
    it('does nothing when no active triggers match event_type', async () => {
      const ctx = makeCtx({ orderBy: vi.fn().mockResolvedValue([]) });
      await core.fireTriggerEvents(ctx, 'customer.create', { customer: { id: 'c1' } });
      expect(ctx.db.db).toHaveBeenCalledWith('automation_triggers');
    });

    it('inserts one event row per action in matching trigger', async () => {
      const trigger = {
        id: 'trig-1',
        tenant_id: 'tenant-123',
        event_type: 'customer.create',
        is_active: true,
        conditions: {},
        actions: [
          { type: 'webhook.call', params: { url: 'https://x.com', method: 'POST' } },
          { type: 'case.create', params: { title: 'New case', priority: 'low' } },
        ],
      };

      const insertMock = vi.fn().mockResolvedValue([]);
      const ctx = makeCtx({
        orderBy: vi.fn().mockResolvedValue([trigger]),
        insert: insertMock,
      });

      await core.fireTriggerEvents(ctx, 'customer.create', { customer: { id: 'c1' } });

      expect(insertMock).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ action_index: 0, action_type: 'webhook.call' }),
          expect.objectContaining({ action_index: 1, action_type: 'case.create' }),
        ]),
      );
    });

    it('skips trigger whose conditions do not match', async () => {
      const trigger = {
        id: 'trig-1',
        tenant_id: 'tenant-123',
        event_type: 'customer.create',
        is_active: true,
        conditions: { and: [{ field: 'company', op: 'equals', value: 'SpecificCo' }] },
        actions: [{ type: 'webhook.call', params: { url: 'https://x.com', method: 'POST' } }],
      };

      const insertMock = vi.fn();
      const ctx = makeCtx({
        orderBy: vi.fn().mockResolvedValue([trigger]),
        insert: insertMock,
      });

      await core.fireTriggerEvents(ctx, 'customer.create', { customer: { company: 'OtherCo' } });
      expect(insertMock).not.toHaveBeenCalled();
    });

    it('skips trigger with no actions', async () => {
      const trigger = {
        id: 'trig-2',
        tenant_id: 'tenant-123',
        event_type: 'customer.create',
        is_active: true,
        conditions: {},
        actions: [],
      };

      const insertMock = vi.fn();
      const ctx = makeCtx({
        orderBy: vi.fn().mockResolvedValue([trigger]),
        insert: insertMock,
      });

      await core.fireTriggerEvents(ctx, 'customer.create', { customer: { id: 'c1' } });
      expect(insertMock).not.toHaveBeenCalled();
    });
  });

  describe('evaluateConditions', () => {
    it('returns true for empty conditions', () => {
      expect(core.evaluateConditions({}, {})).toBe(true);
    });

    it('returns true for null conditions', () => {
      expect(core.evaluateConditions(null as any, {})).toBe(true);
    });

    it('equals operator matches exact value', () => {
      expect(core.evaluateConditions(
        { and: [{ field: 'company', op: 'equals', value: 'Acme' }] },
        { customer: { company: 'Acme' } }
      )).toBe(true);
      expect(core.evaluateConditions(
        { and: [{ field: 'company', op: 'equals', value: 'Acme' }] },
        { customer: { company: 'Other' } }
      )).toBe(false);
    });

    it('contains operator works', () => {
      expect(core.evaluateConditions(
        { and: [{ field: 'email', op: 'contains', value: '@gmail' }] },
        { customer: { email: 'alice@gmail.com' } }
      )).toBe(true);
    });

    it('is_empty operator works', () => {
      expect(core.evaluateConditions(
        { and: [{ field: 'phone', op: 'is_empty' }] },
        { customer: { phone: '' } }
      )).toBe(true);
      expect(core.evaluateConditions(
        { and: [{ field: 'phone', op: 'is_empty' }] },
        { customer: { phone: '123' } }
      )).toBe(false);
    });
  });
});
