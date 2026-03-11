import { describe, it, expect, vi, beforeEach } from 'vitest';

// All mock variables must use vi.hoisted()
const mockUpdate = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const mockFirst = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'cust-1', tenant_id: 'tenant-1' }));
const mockWhere = vi.hoisted(() => vi.fn().mockReturnThis());
const mockSelect = vi.hoisted(() => vi.fn().mockReturnThis());
const mockRaw = vi.hoisted(() => vi.fn().mockReturnValue('NOW()'));

const mockKnexFn = vi.hoisted(() =>
  vi.fn().mockReturnValue({ where: mockWhere, update: mockUpdate, first: mockFirst, select: mockSelect }),
);
(mockKnexFn as any).raw = mockRaw;

import { CustomerUpdateFieldHandler } from '../handlers/customer-update-field.handler';
import type { ActionCommandContext } from '../handlers/command-handler.interface';

const ctx: ActionCommandContext = {
  tenantId: 'tenant-1',
  eventId: 'event-1',
  triggerId: 'trigger-1',
  triggerContext: { customer: { id: 'cust-1', name: 'Alice' } },
};

describe('CustomerUpdateFieldHandler', () => {
  let handler: CustomerUpdateFieldHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFirst.mockResolvedValue({ id: 'cust-1', tenant_id: 'tenant-1' });
    mockUpdate.mockResolvedValue(1);
    handler = new CustomerUpdateFieldHandler(mockKnexFn as any);
  });

  it('has correct actionType', () => {
    expect(handler.actionType).toBe('customer.update_field');
  });

  it('updates the specified field on customers table', async () => {
    await handler.execute(ctx, { field: 'company', value: 'Acme Corp' });
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ company: 'Acme Corp' }));
  });

  it('resolves template in value', async () => {
    await handler.execute(ctx, { field: 'name', value: '{{customer.name}} Updated' });
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Alice Updated' }));
  });

  it('throws when customer not found', async () => {
    mockFirst.mockResolvedValue(null);
    await expect(
      handler.execute(ctx, { field: 'company', value: 'X' }),
    ).rejects.toThrow('Customer not found');
  });

  it('throws when customer belongs to different tenant', async () => {
    mockFirst.mockResolvedValue({ id: 'cust-1', tenant_id: 'other-tenant' });
    await expect(
      handler.execute(ctx, { field: 'company', value: 'X' }),
    ).rejects.toThrow('tenant');
  });

  it('rejects invalid field names', async () => {
    await expect(
      handler.execute(ctx, { field: 'invalid_field', value: 'X' }),
    ).rejects.toThrow('Invalid field');
  });
});
