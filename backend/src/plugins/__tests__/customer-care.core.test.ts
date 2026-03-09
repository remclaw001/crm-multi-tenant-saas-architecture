import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomerCareCore } from '../cores/customer-care/customer-care.core';
import { ResourceNotFoundError } from '../../common/errors/domain.errors';
import type { IExecutionContext } from '../interfaces/execution-context.interface';

function makeBuilder(overrides: Record<string, unknown> = {}) {
  return {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    join: vi.fn().mockReturnThis(),
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
    enabledPlugins: ['customer-care'],
    userId: 'user-abc',
    userRoles: [],
    requestId: 'req-xyz',
    db: { db: dbFn } as any,
    cache: {} as any,
  };
}

const mockRegistry = { register: vi.fn() };
const mockHookRegistry = { register: vi.fn(), runBefore: vi.fn(), runAfter: vi.fn() };

describe('CustomerCareCore', () => {
  let core: CustomerCareCore;

  beforeEach(() => {
    vi.clearAllMocks();
    core = new CustomerCareCore(mockRegistry as any, mockHookRegistry as any);
  });

  describe('onModuleInit', () => {
    it('registers after:customer.create hook', () => {
      core.onModuleInit();
      expect(mockHookRegistry.register).toHaveBeenCalledWith(
        'customer-care',
        expect.objectContaining({ event: 'customer.create', type: 'after' }),
        expect.any(Function),
      );
    });
  });

  describe('listCases', () => {
    it('queries support_cases table', async () => {
      const ctx = makeCtx();
      await core.listCases(ctx);
      expect(ctx.db.db).toHaveBeenCalledWith('support_cases');
    });

    it('returns empty array when no cases', async () => {
      const ctx = makeCtx({ orderBy: vi.fn().mockResolvedValue([]) });
      const result = await core.listCases(ctx);
      expect(result).toEqual([]);
    });

    it('joins customers table for customer_name', async () => {
      const rows = [{ id: 'case-1', title: 'Bug', customer_name: 'Alice' }];
      const ctx = makeCtx({ orderBy: vi.fn().mockResolvedValue(rows) });
      const result = await core.listCases(ctx);
      expect(ctx.db.db).toHaveBeenCalledWith('support_cases');
      const builder = (ctx.db.db as any).mock.results[0].value;
      expect(builder.join).toHaveBeenCalledWith('customers', 'support_cases.customer_id', 'customers.id');
      expect(result).toEqual(rows);
    });
  });

  describe('getCase', () => {
    it('returns case when found', async () => {
      const row = { id: 'case-1', title: 'Bug report' };
      const ctx = makeCtx({ first: vi.fn().mockResolvedValue(row) });
      const result = await core.getCase(ctx, 'case-1');
      expect(result).toEqual(row);
    });

    it('throws ResourceNotFoundError when not found', async () => {
      const ctx = makeCtx({ first: vi.fn().mockResolvedValue(null) });
      await expect(core.getCase(ctx, 'missing')).rejects.toThrow(ResourceNotFoundError);
    });
  });

  describe('createCase', () => {
    it('inserts into support_cases and returns new row', async () => {
      const newCase = { id: 'case-new', title: 'New issue' };
      const ctx = makeCtx({
        first: vi.fn().mockResolvedValue({ id: 'cust-1', name: 'Alice' }),
        returning: vi.fn().mockResolvedValue([newCase]),
      });
      const result = await core.createCase(ctx, { customer_id: 'cust-1', title: 'New issue' });
      expect(ctx.db.db).toHaveBeenCalledWith('customers');
      expect(ctx.db.db).toHaveBeenCalledWith('support_cases');
      expect(result).toEqual(newCase);
    });

    it('throws ResourceNotFoundError when customer_id does not exist', async () => {
      const ctx = makeCtx({ first: vi.fn().mockResolvedValue(null) });
      await expect(
        core.createCase(ctx, { customer_id: 'bad-id', title: 'Test' })
      ).rejects.toThrow(ResourceNotFoundError);
    });
  });

  describe('updateCase', () => {
    it('returns updated case', async () => {
      const updated = { id: 'case-1', status: 'resolved' };
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([updated]) });
      const result = await core.updateCase(ctx, 'case-1', { status: 'resolved' });
      expect(result).toEqual(updated);
    });

    it('throws ResourceNotFoundError when case not found', async () => {
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([]) });
      await expect(core.updateCase(ctx, 'missing', { status: 'resolved' })).rejects.toThrow(ResourceNotFoundError);
    });

    it('sets resolved_at when status becomes resolved', async () => {
      const updated = { id: 'case-1', status: 'resolved', resolved_at: new Date() };
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([updated]) });
      const result = await core.updateCase(ctx, 'case-1', { status: 'resolved' });
      expect(result.resolved_at).toBeDefined();
    });
  });

  describe('deleteCase', () => {
    it('deletes case and returns void', async () => {
      const ctx = makeCtx({ del: vi.fn().mockResolvedValue(1) });
      await expect(core.deleteCase(ctx, 'case-1')).resolves.toBeUndefined();
    });

    it('throws ResourceNotFoundError when case not found', async () => {
      const ctx = makeCtx({ del: vi.fn().mockResolvedValue(0) });
      await expect(core.deleteCase(ctx, 'missing')).rejects.toThrow(ResourceNotFoundError);
    });
  });
});
