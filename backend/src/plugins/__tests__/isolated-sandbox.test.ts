// ============================================================
// IsolatedSandboxService unit tests
//
// isolated-vm is a native C++ addon. Tests mock the entire module
// so they run without native binaries and with deterministic behavior.
//
// Mock strategy:
//   MockIsolate   — controls memoryLimit, tracks dispose() calls
//   MockScript    — configurable: resolve value | throw error
//   MockContext   — tracks global.set() calls; exposes eval()
//   MockReference — wraps host functions; exposes applySyncPromise/applySync
//
// vi.mock() is hoisted by Vitest before any static import, so
// IsolatedSandboxService receives the mock when it does
// `import ivm from 'isolated-vm'`.
//
// Test coverage:
//   ✓ Success path — result returned, dispose() called, metric observed
//   ✓ Timeout      — "Script execution timed out" → GatewayTimeoutException
//   ✓ Memory       — "memory limit" / "Isolate was disposed" → 500
//   ✓ Query limit  — QueryLimitExceededError propagated + metric
//   ✓ Bridge setup — __tenantId/__userId/__requestId globals injected
//   ✓ References   — five __xxx References injected
//   ✓ Dispose      — isolate.dispose() called even on error
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GatewayTimeoutException,
  InternalServerErrorException,
} from '@nestjs/common';

import { QueryLimitExceededError } from '../../dal/middleware/QueryCounter';
import type { SandboxBridge } from '../sandbox/sandbox-bridge';
import type { PrometheusService } from '../../observability/metrics/prometheus.service';

// ── Mock isolated-vm ───────────────────────────────────────────
// Must be declared before the import of IsolatedSandboxService so
// Vitest's hoist mechanism intercepts the `import ivm from 'isolated-vm'`
// call inside that module.

const mockDispose = vi.fn();
const mockGlobalSet = vi.fn();
const mockEval = vi.fn<[string], Promise<void>>().mockResolvedValue(undefined);

// Configurable run behavior — tests override these per case
let mockRunResult: unknown = 'default-result';
let mockRunError: Error | null = null;

vi.mock('isolated-vm', () => {
  class MockReference {
    constructor(public readonly fn: (...args: unknown[]) => unknown) {}

    async applySyncPromise(_thisArg: unknown, args: unknown[]): Promise<unknown> {
      return this.fn(...args);
    }

    applySync(_thisArg: unknown, args: unknown[]): unknown {
      return this.fn(...args);
    }
  }

  class MockContext {
    global = { set: mockGlobalSet, derefInto: () => ({}) };
    eval = mockEval;
  }

  class MockScript {
    async run(_context: MockContext, _opts?: Record<string, unknown>): Promise<unknown> {
      if (mockRunError) throw mockRunError;
      return mockRunResult;
    }
  }

  class MockIsolate {
    constructor(public readonly opts: { memoryLimit: number }) {}

    async createContext(): Promise<MockContext> {
      return new MockContext();
    }

    async compileScript(_code: string): Promise<MockScript> {
      return new MockScript();
    }

    dispose = mockDispose;
  }

  return {
    default: {
      Isolate: MockIsolate,
      Reference: MockReference,
    },
  };
});

// ── Static import (mock is now in place via hoisting) ──────────
import { IsolatedSandboxService } from '../sandbox/isolated-sandbox.service';

// ── Mock PrometheusService ─────────────────────────────────────
const mockObserve = vi.fn();
const mockInc = vi.fn();
const mockPrometheus = {
  sandboxExecutionDuration: { observe: mockObserve },
  sandboxViolationsTotal: { inc: mockInc },
} as unknown as PrometheusService;

// ── Helper ─────────────────────────────────────────────────────
function makeBridge(overrides: Partial<SandboxBridge> = {}): SandboxBridge {
  return {
    tenantId: 'tenant-uuid',
    userId: 'user-uuid',
    requestId: 'req-uuid',
    db: {
      query: vi.fn().mockResolvedValue([{ id: '1', name: 'Alice' }]),
      count: vi.fn().mockResolvedValue(5),
    },
    cache: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    },
    log: vi.fn(),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────
describe('IsolatedSandboxService', () => {
  let service: IsolatedSandboxService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRunResult = 'default-result';
    mockRunError = null;
    // Re-mock eval after clearAllMocks to keep the resolved value
    mockEval.mockResolvedValue(undefined);
    service = new IsolatedSandboxService(mockPrometheus);
  });

  // ── Success path ─────────────────────────────────────────────
  describe('successful execution', () => {
    it('returns the value produced by the script', async () => {
      mockRunResult = { id: '42', name: 'Test' };
      const result = await service.runScript('return ctx.tenantId;', makeBridge());
      expect(result).toEqual({ id: '42', name: 'Test' });
    });

    it('records success metric with non-negative duration', async () => {
      mockRunResult = 'ok';
      await service.runScript('', makeBridge());

      expect(mockObserve).toHaveBeenCalledWith(
        { result: 'success' },
        expect.any(Number),
      );
      const duration = (mockObserve.mock.calls[0] as [unknown, number])[1];
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    it('disposes isolate after successful execution', async () => {
      mockRunResult = null;
      await service.runScript('', makeBridge());
      expect(mockDispose).toHaveBeenCalledOnce();
    });
  });

  // ── Timeout enforcement ───────────────────────────────────────
  describe('timeout enforcement', () => {
    it('maps "Script execution timed out" to GatewayTimeoutException', async () => {
      mockRunError = new Error('Script execution timed out.');
      await expect(
        service.runScript('while(true){}', makeBridge()),
      ).rejects.toThrow(GatewayTimeoutException);
    });

    it('error message mentions "5 s limit"', async () => {
      mockRunError = new Error('Script execution timed out.');
      await expect(
        service.runScript('', makeBridge()),
      ).rejects.toThrow(/5 s limit/);
    });

    it('increments timeout violation metric', async () => {
      mockRunError = new Error('Script execution timed out.');
      await expect(service.runScript('', makeBridge())).rejects.toThrow();
      expect(mockInc).toHaveBeenCalledWith({ limit_type: 'timeout' });
    });

    it('disposes isolate even after timeout', async () => {
      mockRunError = new Error('Script execution timed out.');
      await expect(service.runScript('', makeBridge())).rejects.toThrow();
      expect(mockDispose).toHaveBeenCalledOnce();
    });
  });

  // ── Memory limit enforcement ──────────────────────────────────
  describe('memory limit enforcement', () => {
    it('maps "memory limit" to InternalServerErrorException', async () => {
      mockRunError = new Error('RangeError: memory limit exceeded');
      await expect(
        service.runScript('', makeBridge()),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('maps "Isolate was disposed" to InternalServerErrorException', async () => {
      mockRunError = new Error('Isolate was disposed during execution');
      await expect(
        service.runScript('', makeBridge()),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('error message mentions "50 MB"', async () => {
      mockRunError = new Error('memory limit exceeded');
      await expect(
        service.runScript('', makeBridge()),
      ).rejects.toThrow(/50 MB/);
    });

    it('increments memory violation metric', async () => {
      mockRunError = new Error('memory limit exceeded');
      await expect(service.runScript('', makeBridge())).rejects.toThrow();
      expect(mockInc).toHaveBeenCalledWith({ limit_type: 'memory' });
    });

    it('disposes isolate after memory error', async () => {
      mockRunError = new Error('Isolate was disposed');
      await expect(service.runScript('', makeBridge())).rejects.toThrow();
      expect(mockDispose).toHaveBeenCalledOnce();
    });
  });

  // ── Query limit enforcement ───────────────────────────────────
  describe('query limit enforcement', () => {
    it('re-throws QueryLimitExceededError unchanged', async () => {
      mockRunError = new QueryLimitExceededError(51, 50);
      await expect(service.runScript('', makeBridge())).rejects.toThrow(
        QueryLimitExceededError,
      );
    });

    it('increments query_limit violation metric', async () => {
      mockRunError = new QueryLimitExceededError(51, 50);
      await expect(service.runScript('', makeBridge())).rejects.toThrow();
      expect(mockInc).toHaveBeenCalledWith({ limit_type: 'query_limit' });
    });

    it('disposes isolate after query limit error', async () => {
      mockRunError = new QueryLimitExceededError(51, 50);
      await expect(service.runScript('', makeBridge())).rejects.toThrow();
      expect(mockDispose).toHaveBeenCalledOnce();
    });
  });

  // ── Context bridge injection ──────────────────────────────────
  describe('context bridge injection', () => {
    it('injects tenantId, userId, requestId as isolate globals', async () => {
      mockRunResult = null;
      const bridge = makeBridge();
      await service.runScript('', bridge);

      expect(mockGlobalSet).toHaveBeenCalledWith(
        '__tenantId', bridge.tenantId, { copy: true },
      );
      expect(mockGlobalSet).toHaveBeenCalledWith(
        '__userId', bridge.userId, { copy: true },
      );
      expect(mockGlobalSet).toHaveBeenCalledWith(
        '__requestId', bridge.requestId, { copy: true },
      );
    });

    it('injects five host References as isolate globals', async () => {
      mockRunResult = null;
      await service.runScript('', makeBridge());

      const names = (mockGlobalSet.mock.calls as [string, unknown][])
        .map(([n]) => n);

      expect(names).toContain('__db_query');
      expect(names).toContain('__db_count');
      expect(names).toContain('__cache_get');
      expect(names).toContain('__cache_set');
      expect(names).toContain('__log');
    });

    it('evaluates the bridge setup script with applySyncPromise', async () => {
      mockRunResult = null;
      await service.runScript('', makeBridge());

      expect(mockEval).toHaveBeenCalledOnce();
      const setupCode = (mockEval.mock.calls[0] as [string])[0];
      // Verify the setup script wires db / cache / ctx wrappers
      expect(setupCode).toContain('applySyncPromise');
      expect(setupCode).toContain('ctx');
    });
  });

  // ── Unknown errors ────────────────────────────────────────────
  describe('unknown errors', () => {
    it('propagates non-classified errors as-is', async () => {
      const original = new TypeError('unexpected internal error');
      mockRunError = original;
      await expect(service.runScript('', makeBridge())).rejects.toThrow(TypeError);
    });

    it('still records an error metric for unknown errors', async () => {
      mockRunError = new TypeError('some error');
      await expect(service.runScript('', makeBridge())).rejects.toThrow();

      expect(mockObserve).toHaveBeenCalledWith(
        { result: 'error' },
        expect.any(Number),
      );
    });

    it('still disposes isolate after unknown errors', async () => {
      mockRunError = new TypeError('some error');
      await expect(service.runScript('', makeBridge())).rejects.toThrow();
      expect(mockDispose).toHaveBeenCalledOnce();
    });
  });
});
