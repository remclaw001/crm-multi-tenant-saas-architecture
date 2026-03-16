import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── BullMQ Queue mock ──────────────────────────────────────────────────
const mockQueueAdd = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockQueue    = vi.hoisted(() => ({ add: mockQueueAdd }));

// ── Knex mock ──────────────────────────────────────────────────────────
const mockRows = vi.hoisted(() => [
  { id: 'evt-1', event_name: 'customer.create', tenant_id: 'ten-1', tenant_tier: 'basic', payload: '{"customer":{"id":"c1"}}' },
]);
const mockUpdate   = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const mockWhereIn  = vi.hoisted(() => vi.fn().mockReturnThis());
const mockLimit    = vi.hoisted(() => vi.fn().mockResolvedValue(mockRows));
const mockSkipLocked = vi.hoisted(() => vi.fn().mockReturnThis());
const mockForUpdate  = vi.hoisted(() => vi.fn().mockReturnThis());
const mockSelect     = vi.hoisted(() => vi.fn().mockReturnThis());
const mockWhere      = vi.hoisted(() => vi.fn().mockReturnThis());
const mockJoin       = vi.hoisted(() => vi.fn().mockReturnThis());

const mockTrx = vi.hoisted(() => {
  const fn = vi.fn().mockReturnValue({
    join: mockJoin,
    where: mockWhere,
    select: mockSelect,
    forUpdate: mockForUpdate,
    skipLocked: mockSkipLocked,
    limit: mockLimit,
    whereIn: mockWhereIn,
    update: mockUpdate,
  });
  return fn;
});

const mockTransaction = vi.hoisted(() =>
  vi.fn((cb: (trx: any) => Promise<void>) => cb(mockTrx)),
);

const mockKnexFn = vi.hoisted(() => {
  const fn = vi.fn().mockReturnValue({
    join: mockJoin,
    where: mockWhere,
    whereIn: mockWhereIn,
    update: mockUpdate,
  });
  (fn as any).transaction = mockTransaction;
  (fn as any).raw = vi.fn((sql: string) => sql);
  return fn;
});

import { EventPollerService } from '../event-poller.service';
import { QUEUE_PLUGIN_EVENTS } from '../../../workers/bullmq/queue.constants';

describe('EventPollerService', () => {
  let svc: EventPollerService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLimit.mockResolvedValue(mockRows);
    svc = new EventPollerService(mockKnexFn as any, mockQueue as any);
  });

  it('does nothing when no pending rows', async () => {
    mockLimit.mockResolvedValueOnce([]);
    await (svc as any).poll();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('marks rows as queued and enqueues each to BullMQ', async () => {
    await (svc as any).poll();

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'queued' }),
    );
    expect(mockQueueAdd).toHaveBeenCalledWith(
      QUEUE_PLUGIN_EVENTS,
      expect.objectContaining({
        eventId:    'evt-1',
        eventName:  'customer.create',
        tenantId:   'ten-1',
        tenantTier: 'basic',
      }),
    );
  });

  it('runs inside a transaction', async () => {
    await (svc as any).poll();
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });
});
