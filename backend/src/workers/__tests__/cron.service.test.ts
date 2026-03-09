// ============================================================
// CronService unit tests
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted() — variables available before vi.mock() factory runs
const { mockTaskStop, mockSchedule } = vi.hoisted(() => ({
  mockTaskStop: vi.fn(),
  mockSchedule: vi.fn().mockReturnValue({ stop: vi.fn() }),
}));

// node-cron exports `schedule` as both named export and on default
vi.mock('node-cron', () => ({
  default: { schedule: mockSchedule },
  schedule: mockSchedule,
}));

import { CronService } from '../scheduler/cron.service';

function makeQueue(waiting = 0, failed = 0) {
  return {
    getWaitingCount: vi.fn().mockResolvedValue(waiting),
    getFailedCount:  vi.fn().mockResolvedValue(failed),
  };
}

describe('CronService', () => {
  let service:       CronService;
  let emailQueue:    ReturnType<typeof makeQueue>;
  let webhookQueue:  ReturnType<typeof makeQueue>;

  beforeEach(() => {
    mockSchedule.mockClear();
    // Each call returns a new task with its own stop() spy
    mockSchedule.mockReturnValue({ stop: mockTaskStop });
    emailQueue   = makeQueue(3, 1);
    webhookQueue = makeQueue(5, 0);
    service = new CronService(emailQueue as any, webhookQueue as any, {
      acquireMetadataConnection: vi.fn(),
    } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('schedules 3 cron jobs on bootstrap', () => {
    service.onApplicationBootstrap();
    expect(mockSchedule).toHaveBeenCalledTimes(3);
  });

  it('schedules cleanup-sessions at 02:00 daily', () => {
    service.onApplicationBootstrap();
    const patterns = mockSchedule.mock.calls.map((c: unknown[]) => c[0]);
    expect(patterns).toContain('0 2 * * *');
  });

  it('schedules queue-depth report every 5 minutes', () => {
    service.onApplicationBootstrap();
    const patterns = mockSchedule.mock.calls.map((c: unknown[]) => c[0]);
    expect(patterns).toContain('*/5 * * * *');
  });

  it('stops all tasks on shutdown', () => {
    service.onApplicationBootstrap();
    service.onApplicationShutdown();
    expect(mockTaskStop).toHaveBeenCalledTimes(3);
  });
});
