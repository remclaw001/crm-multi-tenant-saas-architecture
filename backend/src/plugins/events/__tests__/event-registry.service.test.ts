import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { ResourceNotFoundError } from '../../../common/errors/domain.errors';

// ── Knex mock ──────────────────────────────────────────────────────────
const mockInsert = vi.hoisted(() => vi.fn().mockResolvedValue([1]));
const mockKnexFn = vi.hoisted(() => {
  const fn = vi.fn().mockReturnValue({ insert: mockInsert });
  (fn as any).raw = vi.fn((sql: string) => sql);
  return fn;
});

vi.mock('knex', () => ({ default: vi.fn() }));

import { EventRegistryService } from '../event-registry.service';
import type { EventDefinition } from '../event-definition.interface';

const customerSchema = z.object({
  customer: z.object({ id: z.string().uuid(), name: z.string() }),
});

const customerDef: EventDefinition = {
  name: 'customer.create',
  plugin: 'customer-data',
  description: 'Fired when a customer is created',
  schema: customerSchema,
};

function makeCtx(tenantId = 'tenant-1') {
  return { tenantId } as any;
}

describe('EventRegistryService', () => {
  let svc: EventRegistryService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new EventRegistryService(mockKnexFn as any);
  });

  describe('register / getDefinition / getDefinitions', () => {
    it('returns undefined for unknown event', () => {
      expect(svc.getDefinition('nope')).toBeUndefined();
    });

    it('returns definition after register', () => {
      svc.register(customerDef);
      expect(svc.getDefinition('customer.create')).toBe(customerDef);
    });

    it('getDefinitions returns all registered definitions', () => {
      svc.register(customerDef);
      expect(svc.getDefinitions()).toHaveLength(1);
      expect(svc.getDefinitions()[0].name).toBe('customer.create');
    });
  });

  describe('emit', () => {
    it('throws for unknown event', async () => {
      await expect(svc.emit('no.such', makeCtx(), {})).rejects.toThrow(ResourceNotFoundError);
    });

    it('throws when payload fails Zod schema', async () => {
      svc.register(customerDef);
      await expect(
        svc.emit('customer.create', makeCtx(), { customer: { id: 'not-a-uuid', name: 'X' } }),
      ).rejects.toThrow();
    });

    it('INSERTs to plugin_events on valid payload', async () => {
      svc.register(customerDef);
      const payload = { customer: { id: '00000000-0000-0000-0000-000000000001', name: 'Alice' } };
      await svc.emit('customer.create', makeCtx('t-1'), payload);

      expect(mockKnexFn).toHaveBeenCalledWith('plugin_events');
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id:  't-1',
          event_name: 'customer.create',
          plugin:     'customer-data',
          status:     'pending',
          expires_at: "NOW() + INTERVAL '7 days'",
        }),
      );
    });

    it('serialises payload as JSON string', async () => {
      svc.register(customerDef);
      const payload = { customer: { id: '00000000-0000-0000-0000-000000000001', name: 'Bob' } };
      await svc.emit('customer.create', makeCtx(), payload);
      const inserted = mockInsert.mock.calls[0][0];
      expect(typeof inserted.payload).toBe('string');
      expect(JSON.parse(inserted.payload)).toEqual(payload);
    });
  });
});
