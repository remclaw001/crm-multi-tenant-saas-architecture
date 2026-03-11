import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInsert = vi.hoisted(() => vi.fn().mockReturnThis());
const mockReturning = vi.hoisted(() => vi.fn().mockResolvedValue([{ id: 'case-new' }]));
const mockFirst = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'cust-1', tenant_id: 'tenant-1' }));
const mockWhere = vi.hoisted(() => vi.fn().mockReturnThis());
const mockSelect = vi.hoisted(() => vi.fn().mockReturnThis());
const mockKnexFn = vi.hoisted(() =>
  vi.fn().mockReturnValue({ where: mockWhere, select: mockSelect, first: mockFirst, insert: mockInsert, returning: mockReturning }),
);

import { CaseCreateHandler } from '../handlers/case-create.handler';
import type { ActionCommandContext } from '../handlers/command-handler.interface';

const ctx: ActionCommandContext = {
  tenantId: 'tenant-1',
  eventId: 'event-1',
  triggerId: 'trigger-1',
  triggerContext: { customer: { id: 'cust-1', name: 'Alice', email: 'alice@test.com' } },
};

describe('CaseCreateHandler', () => {
  let handler: CaseCreateHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFirst.mockResolvedValue({ id: 'cust-1', tenant_id: 'tenant-1' });
    mockReturning.mockResolvedValue([{ id: 'case-new' }]);
    handler = new CaseCreateHandler(mockKnexFn as any);
  });

  it('has correct actionType', () => {
    expect(handler.actionType).toBe('case.create');
  });

  it('inserts a support_case with resolved title', async () => {
    await handler.execute(ctx, {
      title: 'Welcome {{customer.name}}',
      priority: 'medium',
    });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-1',
        customer_id: 'cust-1',
        title: 'Welcome Alice',
        priority: 'medium',
        status: 'open',
      }),
    );
  });

  it('throws when customer not found', async () => {
    mockFirst.mockResolvedValue(null);
    await expect(
      handler.execute(ctx, { title: 'Test', priority: 'low' }),
    ).rejects.toThrow('Customer not found');
  });

  it('throws when customer belongs to different tenant', async () => {
    mockFirst.mockResolvedValue({ id: 'cust-1', tenant_id: 'other' });
    await expect(
      handler.execute(ctx, { title: 'Test', priority: 'low' }),
    ).rejects.toThrow('Customer not found');
  });
});
