import { describe, it, expect, vi, beforeEach } from 'vitest';

// All mocks MUST use vi.hoisted()
const mockForUpdate = vi.hoisted(() => vi.fn().mockReturnThis());
const mockSkipLocked = vi.hoisted(() => vi.fn().mockReturnThis());
const mockLimit = vi.hoisted(() => vi.fn().mockReturnThis());
const mockUpdate = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const mockWhereIn = vi.hoisted(() => vi.fn().mockReturnThis());
const mockSelect = vi.hoisted(() => vi.fn().mockReturnThis());
const mockWhere = vi.hoisted(() => vi.fn().mockReturnThis());
const mockOrderBy = vi.hoisted(() => vi.fn().mockReturnThis());
const mockReturning = vi.hoisted(() => vi.fn().mockResolvedValue([]));

const mockTrx = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    where: mockWhere,
    select: mockSelect,
    orderBy: mockOrderBy,
    limit: mockLimit,
    forUpdate: mockForUpdate,
    skipLocked: mockSkipLocked,
    whereIn: mockWhereIn,
    update: mockUpdate,
    returning: mockReturning,
  })
);
(mockTrx as any).raw = vi.fn();

const mockTransaction = vi.hoisted(() => vi.fn((fn: (trx: any) => Promise<unknown>) => fn(mockTrx)));

const mockKnexFn = vi.hoisted(() => {
  const fn = vi.fn().mockReturnValue({
    where: mockWhere,
    select: mockSelect,
    orderBy: mockOrderBy,
    limit: mockLimit,
    forUpdate: mockForUpdate,
    skipLocked: mockSkipLocked,
  });
  (fn as any).transaction = mockTransaction;
  return fn;
});

const mockQueueAdd = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockQueue = vi.hoisted(() => ({ add: mockQueueAdd }));

import { AutomationActionPoller } from '../automation-action.poller';

describe('AutomationActionPoller', () => {
  let poller: AutomationActionPoller;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset transaction to return empty by default
    mockTransaction.mockImplementation((fn: (trx: any) => Promise<unknown>) => fn(mockTrx));
    // Default: no pending events
    mockReturning.mockResolvedValue([]);
    // Default: update works
    mockUpdate.mockResolvedValue(1);
    poller = new AutomationActionPoller(mockKnexFn as any, mockQueue as any);
  });

  it('does nothing when no pending events found', async () => {
    mockReturning.mockResolvedValue([]);
    await poller.poll();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('adds one BullMQ job per claimed event', async () => {
    const events = [
      { id: 'evt-1', tenant_id: 't1', trigger_id: 'trig-1', action_index: 0,
        action_type: 'webhook.call', action_params: {}, trigger_context: {} },
    ];
    mockReturning.mockResolvedValue(events);
    await poller.poll();
    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'execute-action',
      expect.objectContaining({ eventId: 'evt-1', actionType: 'webhook.call' }),
      expect.objectContaining({ attempts: 3 }),
    );
  });
});
