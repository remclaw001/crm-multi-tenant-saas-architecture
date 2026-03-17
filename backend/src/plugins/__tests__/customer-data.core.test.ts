import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomerDataCore } from '../cores/customer-data/customer-data.core';
import { ResourceNotFoundError } from '../../common/errors/domain.errors';
import type { IExecutionContext } from '../interfaces/execution-context.interface';

function makeDb(overrides: Record<string, unknown> = {}) {
  const builder: any = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    returning: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
  const dbFn: any = vi.fn().mockReturnValue(builder);
  dbFn.raw = vi.fn().mockReturnValue('NOW()');
  return { db: dbFn, _builder: builder };
}

function makeCtx(dbOverrides = {}): IExecutionContext {
  const db = makeDb(dbOverrides);
  return {
    tenantId: 'tenant-123', tenantTier: 'basic', tenantConfig: {},
    enabledPlugins: ['customer-data'], userId: 'user-abc', userRoles: [],
    requestId: 'req-xyz', db: db as any, cache: {} as any,
  };
}

const mockRegistry = { register: vi.fn() };
const mockHookRegistry = {
  runBefore: vi.fn().mockResolvedValue(undefined),
  runAfter: vi.fn().mockResolvedValue(undefined),
};
const mockEventRegistry = {
  emit: vi.fn().mockResolvedValue(undefined),
  register: vi.fn(),
};

describe('CustomerDataCore', () => {
  let core: CustomerDataCore;

  beforeEach(() => {
    vi.clearAllMocks();
    core = new CustomerDataCore(mockRegistry as any, mockHookRegistry as any, mockEventRegistry as any);
  });

  describe('listCustomers', () => {
    it('queries customers table', async () => {
      const rows = [{ id: '1', name: 'Alice' }];
      const ctx = makeCtx({ limit: vi.fn().mockResolvedValue(rows) });
      const result = await core.listCustomers(ctx);
      expect(ctx.db.db).toHaveBeenCalledWith('customers');
      expect(result).toEqual(rows);
    });

    it('applies is_active=true filter by default (no filter arg)', async () => {
      const ctx = makeCtx({ limit: vi.fn().mockResolvedValue([]) });
      await core.listCustomers(ctx);
      expect(ctx.db._builder.where).toHaveBeenCalledWith('is_active', true);
    });

    it('applies is_active=true when status is "active"', async () => {
      const ctx = makeCtx({ limit: vi.fn().mockResolvedValue([]) });
      await core.listCustomers(ctx, { status: 'active' });
      expect(ctx.db._builder.where).toHaveBeenCalledWith('is_active', true);
    });

    it('applies is_active=false when status is "inactive"', async () => {
      const ctx = makeCtx({ limit: vi.fn().mockResolvedValue([]) });
      await core.listCustomers(ctx, { status: 'inactive' });
      expect(ctx.db._builder.where).toHaveBeenCalledWith('is_active', false);
    });

    it('does not filter is_active when status is "all"', async () => {
      const ctx = makeCtx({ limit: vi.fn().mockResolvedValue([]) });
      await core.listCustomers(ctx, { status: 'all' });
      expect(ctx.db._builder.where).not.toHaveBeenCalledWith('is_active', true);
      expect(ctx.db._builder.where).not.toHaveBeenCalledWith('is_active', false);
    });

    it('applies ILIKE filter for name', async () => {
      const ctx = makeCtx({ limit: vi.fn().mockResolvedValue([]) });
      await core.listCustomers(ctx, { name: 'nguyen' });
      expect(ctx.db._builder.where).toHaveBeenCalledWith('name', 'ilike', '%nguyen%');
    });

    it('applies ILIKE filter for company', async () => {
      const ctx = makeCtx({ limit: vi.fn().mockResolvedValue([]) });
      await core.listCustomers(ctx, { company: 'acme' });
      expect(ctx.db._builder.where).toHaveBeenCalledWith('company', 'ilike', '%acme%');
    });

    it('applies ILIKE filter for phone', async () => {
      const ctx = makeCtx({ limit: vi.fn().mockResolvedValue([]) });
      await core.listCustomers(ctx, { phone: '0912' });
      expect(ctx.db._builder.where).toHaveBeenCalledWith('phone', 'ilike', '%0912%');
    });

    it('combines multiple filters with AND logic', async () => {
      const ctx = makeCtx({ limit: vi.fn().mockResolvedValue([]) });
      await core.listCustomers(ctx, { status: 'inactive', name: 'bob', company: 'xyz' });
      expect(ctx.db._builder.where).toHaveBeenCalledWith('is_active', false);
      expect(ctx.db._builder.where).toHaveBeenCalledWith('name', 'ilike', '%bob%');
      expect(ctx.db._builder.where).toHaveBeenCalledWith('company', 'ilike', '%xyz%');
    });
  });

  describe('getCustomer', () => {
    it('returns customer when found', async () => {
      const row = { id: 'cust-1', name: 'Bob' };
      const ctx = makeCtx({ first: vi.fn().mockResolvedValue(row) });
      expect(await core.getCustomer(ctx, 'cust-1')).toEqual(row);
    });

    it('throws ResourceNotFoundError when not found', async () => {
      const ctx = makeCtx({ first: vi.fn().mockResolvedValue(null) });
      await expect(core.getCustomer(ctx, 'x')).rejects.toThrow(ResourceNotFoundError);
    });
  });

  describe('createCustomer', () => {
    it('inserts and returns new row', async () => {
      const newCustomer = { id: 'new-1', name: 'Carol' };
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([newCustomer]) });
      expect(await core.createCustomer(ctx, { name: 'Carol' })).toEqual(newCustomer);
      expect(ctx.db.db).toHaveBeenCalledWith('customers');
    });

    it('calls runBefore BEFORE insert, runAfter AFTER', async () => {
      const order: string[] = [];
      const ctx = makeCtx({
        returning: vi.fn().mockImplementation(() => { order.push('insert'); return Promise.resolve([{ id: '1', name: 'X' }]); }),
      });
      mockHookRegistry.runBefore.mockImplementation(async () => { order.push('before'); });
      mockHookRegistry.runAfter.mockImplementation(async () => { order.push('after'); });
      await core.createCustomer(ctx, { name: 'X' });
      expect(order).toEqual(['before', 'insert', 'after']);
    });

    it('calls runBefore with customer.create event', async () => {
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([{ id: '1', name: 'X' }]) });
      await core.createCustomer(ctx, { name: 'X' });
      expect(mockHookRegistry.runBefore).toHaveBeenCalledWith('customer.create', ctx, { name: 'X' });
    });

    it('calls runAfter with the new customer', async () => {
      const newCustomer = { id: 'new-1', name: 'X' };
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([newCustomer]) });
      await core.createCustomer(ctx, { name: 'X' });
      expect(mockHookRegistry.runAfter).toHaveBeenCalledWith('customer.create', ctx, newCustomer);
    });
  });

  describe('updateCustomer', () => {
    it('returns updated customer', async () => {
      const updated = { id: 'cust-1', name: 'Updated' };
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([updated]) });
      expect(await core.updateCustomer(ctx, 'cust-1', { name: 'Updated' })).toEqual(updated);
    });

    it('throws ResourceNotFoundError when not found', async () => {
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([]) });
      await expect(core.updateCustomer(ctx, 'x', { name: 'Y' })).rejects.toThrow(ResourceNotFoundError);
    });
  });

  describe('deleteCustomer', () => {
    it('soft deletes (is_active=false)', async () => {
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([{ id: 'c1' }]) });
      await core.deleteCustomer(ctx, 'c1');
      expect(ctx.db.db).toHaveBeenCalledWith('customers');
    });

    it('throws ResourceNotFoundError when not found', async () => {
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([]) });
      await expect(core.deleteCustomer(ctx, 'x')).rejects.toThrow(ResourceNotFoundError);
    });
  });
});
