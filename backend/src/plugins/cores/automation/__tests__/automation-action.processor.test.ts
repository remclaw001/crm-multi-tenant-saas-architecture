import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGetHandler = vi.hoisted(() => vi.fn().mockReturnValue({ execute: mockExecute }));

const mockKnexUpdate = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const mockKnexWhere = vi.hoisted(() => vi.fn().mockReturnThis());
const mockKnexSelect = vi.hoisted(() => vi.fn().mockReturnThis());
const mockKnexFirst = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'tenant-1', tier: 'basic' }));
const mockKnexRaw = vi.hoisted(() => vi.fn().mockReturnValue('NOW()'));

const mockKnexFn = vi.hoisted(() => {
  const fn = vi.fn().mockReturnValue({
    where: mockKnexWhere,
    update: mockKnexUpdate,
    select: mockKnexSelect,
    first: mockKnexFirst,
  });
  (fn as any).raw = mockKnexRaw;
  return fn;
});

const mockTenantContextRun = vi.hoisted(() => vi.fn((_ctx: unknown, fn: () => Promise<void>) => fn()));

// Mock TenantContext — path must match how the processor imports it
// Processor is at src/plugins/cores/automation/ so it imports ../../../dal/context/TenantContext → src/dal/context/TenantContext
// Test is at src/plugins/cores/automation/__tests__/ so we need ../../../../dal/context/TenantContext
vi.mock('../../../../dal/context/TenantContext', () => ({
  TenantContext: { run: mockTenantContextRun },
}));

import { AutomationActionProcessor } from '../automation-action.processor';
import { ActionRegistry } from '../action-registry';

describe('AutomationActionProcessor', () => {
  let processor: AutomationActionProcessor;
  let registry: ActionRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    mockKnexFirst.mockResolvedValue({ id: 'tenant-1', tier: 'basic' });
    registry = { getHandler: mockGetHandler } as unknown as ActionRegistry;
    processor = new AutomationActionProcessor(mockKnexFn as any, registry);
  });

  function makeJob(overrides: Partial<any> = {}) {
    return {
      data: {
        eventId: 'evt-1',
        tenantId: 'tenant-1',
        triggerId: 'trig-1',
        actionIndex: 0,
        actionType: 'webhook.call',
        actionParams: { url: 'https://x.com', method: 'POST' },
        triggerContext: { customer: { id: 'cust-1' } },
        ...overrides,
      },
    } as any;
  }

  it('marks event as processing first', async () => {
    await processor.process(makeJob());
    // First update call should be status=processing
    expect(mockKnexUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'processing' }),
    );
  });

  it('calls handler execute with resolved params', async () => {
    await processor.process(makeJob());
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', eventId: 'evt-1' }),
      expect.objectContaining({ url: 'https://x.com', method: 'POST' }),
    );
  });

  it('marks event as completed on success', async () => {
    await processor.process(makeJob());
    expect(mockKnexUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' }),
    );
  });

  it('runs handler inside TenantContext.run with tenantId and tenantTier', async () => {
    await processor.process(makeJob());
    expect(mockTenantContextRun).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', tenantTier: 'basic' }),
      expect.any(Function),
    );
  });
});
