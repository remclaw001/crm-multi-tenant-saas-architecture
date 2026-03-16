import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks (vi.hoisted — must be before imports) ───────────────────────
const mockFireTriggerEvents = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockBuildForWorker    = vi.hoisted(() => vi.fn().mockResolvedValue({ tenantId: 'ten-1' }));
const mockTenantContextRun  = vi.hoisted(() =>
  vi.fn((_ctx: unknown, fn: () => Promise<void>) => fn()),
);
const mockKnexUpdate = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const mockKnexWhere  = vi.hoisted(() => vi.fn().mockReturnThis());
const mockKnexFn     = vi.hoisted(() =>
  vi.fn().mockReturnValue({ where: mockKnexWhere, update: mockKnexUpdate }),
);

vi.mock('../../../../dal/context/TenantContext', () => ({
  TenantContext: { run: mockTenantContextRun },
}));

import { AutomationEventProcessor } from '../automation-event.processor';

function makeProcessor() {
  const core    = { fireTriggerEvents: mockFireTriggerEvents } as any;
  const builder = { buildForWorker: mockBuildForWorker }      as any;
  return new AutomationEventProcessor(mockKnexFn as any, core, builder);
}

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      eventId:    'evt-1',
      eventName:  'customer.create',
      tenantId:   'ten-1',
      tenantTier: 'basic',
      payload:    { customer: { id: 'cust-1', name: 'Alice' } },
      ...overrides,
    },
    opts:         { attempts: 3 },
    attemptsMade: 1,
  } as any;
}

describe('AutomationEventProcessor', () => {
  let processor: AutomationEventProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = makeProcessor();
  });

  it('runs inside TenantContext', async () => {
    await processor.process(makeJob());
    expect(mockTenantContextRun).toHaveBeenCalledWith(
      { tenantId: 'ten-1', tenantTier: 'basic' },
      expect.any(Function),
    );
  });

  it('builds worker context and calls fireTriggerEvents', async () => {
    await processor.process(makeJob());
    expect(mockBuildForWorker).toHaveBeenCalledWith('ten-1', 'basic', 'evt-1');
    expect(mockFireTriggerEvents).toHaveBeenCalledWith(
      { tenantId: 'ten-1' },
      'customer.create',
      { customer: { id: 'cust-1', name: 'Alice' } },
    );
  });

  it('marks plugin_event as processed on success', async () => {
    await processor.process(makeJob());
    expect(mockKnexFn).toHaveBeenCalledWith('plugin_events');
    expect(mockKnexWhere).toHaveBeenCalledWith({ id: 'evt-1' });
    expect(mockKnexUpdate).toHaveBeenCalledWith({ status: 'processed' });
  });

  it('onFailed: resets to pending only after max retries exhausted', async () => {
    const job = makeJob();
    job.attemptsMade = 3; // equal to opts.attempts — exhausted
    await processor.onFailed(job, new Error('boom'));
    expect(mockKnexUpdate).toHaveBeenCalledWith({ status: 'pending', queued_at: null });
  });

  it('onFailed: does NOT reset if retries remain', async () => {
    const job = makeJob();
    job.attemptsMade = 1; // attempts=3, still has retries left
    await processor.onFailed(job, new Error('transient'));
    expect(mockKnexUpdate).not.toHaveBeenCalled();
  });
});
