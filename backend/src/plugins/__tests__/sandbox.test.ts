import { describe, it, expect, vi, afterEach } from 'vitest';
import { GatewayTimeoutException } from '@nestjs/common';
import { SandboxService } from '../sandbox/sandbox.service';
import { TenantContext } from '../../dal/context/TenantContext';

// ============================================================
// SandboxService unit tests
//
// Tests:
//  1. Normal execution returns value
//  2. Slow function exceeds timeout → GatewayTimeoutException
//  3. Short timeout overrides the default
//  4. Rejected function propagates the error
//  5. VIP tenant timeout override (10s minimum)
// ============================================================

describe('SandboxService', () => {
  const sandbox = new SandboxService();

  describe('normal execution', () => {
    it('returns the resolved value', async () => {
      const result = await sandbox.execute(async () => 'hello');
      expect(result).toBe('hello');
    });

    it('returns complex objects', async () => {
      const data = { id: '1', name: 'test', values: [1, 2, 3] };
      const result = await sandbox.execute(async () => data);
      expect(result).toEqual(data);
    });

    it('awaits async operations within timeout', async () => {
      const result = await sandbox.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10)); // 10ms — well within 5s
        return 42;
      });
      expect(result).toBe(42);
    });
  });

  describe('timeout enforcement', () => {
    it('throws GatewayTimeoutException when fn exceeds timeoutMs', async () => {
      const slowFn = () =>
        new Promise<never>((resolve) => setTimeout(resolve, 10_000)); // 10s

      await expect(sandbox.execute(slowFn, 50)).rejects.toThrow(GatewayTimeoutException);
    });

    it('timeout error message mentions "Plugin execution timeout"', async () => {
      const slowFn = () =>
        new Promise<never>((resolve) => setTimeout(resolve, 10_000));

      try {
        await sandbox.execute(slowFn, 30);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(GatewayTimeoutException);
        expect((err as GatewayTimeoutException).message).toContain('Plugin execution timeout');
      }
    });

    it('completes successfully when fn resolves just before timeout', async () => {
      const result = await sandbox.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10)); // 10ms
        return 'fast enough';
      }, 500); // 500ms timeout — plenty of room

      expect(result).toBe('fast enough');
    });
  });

  describe('VIP tenant timeout override', () => {
    afterEach(() => {
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('VIP tier with 5000ms gets effective timeout of 10000ms', async () => {
      // fn resolves at 6000ms — would time out with a 5s cap but VIP minimum is 10s.
      vi.spyOn(TenantContext, 'getTier').mockReturnValue('vip');
      vi.useFakeTimers();

      const fnPromise = new Promise<string>((resolve) =>
        setTimeout(() => resolve('vip-result'), 6_000),
      );
      const execPromise = sandbox.execute(() => fnPromise, 5_000);

      // Advance past fn resolution; the 10s sandbox timeout has not fired yet.
      await vi.advanceTimersByTimeAsync(6_001);

      await expect(execPromise).resolves.toBe('vip-result');
    });

    it('non-VIP tier with 5000ms keeps effective timeout of 5000ms', async () => {
      vi.spyOn(TenantContext, 'getTier').mockReturnValue('basic');
      vi.useFakeTimers();

      // fn never resolves — only the sandbox timeout should fire.
      const execPromise = sandbox.execute(
        () => new Promise<never>(() => { /* intentionally never resolves */ }),
        5_000,
      );
      // Suppress potential unhandled rejection while advancing fake timers.
      execPromise.catch(() => undefined);

      // Advance past the 5s timeout — should reject.
      await vi.advanceTimersByTimeAsync(5_001);

      await expect(execPromise).rejects.toThrow(GatewayTimeoutException);
    });

    it('VIP tier with 15000ms keeps effective timeout of 15000ms (no reduction)', async () => {
      // Math.max(15000, 10000) === 15000, so the caller's higher value is preserved.
      vi.spyOn(TenantContext, 'getTier').mockReturnValue('vip');
      vi.useFakeTimers();

      const fnPromise = new Promise<string>((resolve) =>
        setTimeout(() => resolve('done'), 12_000),
      );
      const execPromise = sandbox.execute(() => fnPromise, 15_000);

      // Advance past fn resolution; the 15s sandbox timeout has not fired.
      await vi.advanceTimersByTimeAsync(12_001);

      await expect(execPromise).resolves.toBe('done');
    });

    it('no TenantContext (undefined tier) keeps the provided timeout', async () => {
      vi.spyOn(TenantContext, 'getTier').mockReturnValue(undefined);
      vi.useFakeTimers();

      const execPromise = sandbox.execute(
        () => new Promise<never>(() => { /* intentionally never resolves */ }),
        50,
      );
      // Suppress potential unhandled rejection while advancing fake timers.
      execPromise.catch(() => undefined);

      await vi.advanceTimersByTimeAsync(51);

      await expect(execPromise).rejects.toThrow(GatewayTimeoutException);
    });
  });

  describe('error propagation', () => {
    it('propagates errors from fn', async () => {
      const boom = async () => {
        throw new Error('business logic error');
      };

      await expect(sandbox.execute(boom)).rejects.toThrow('business logic error');
    });

    it('propagates non-timeout errors immediately (not as GatewayTimeoutException)', async () => {
      const boom = async () => {
        throw new TypeError('type mismatch');
      };

      try {
        await sandbox.execute(boom);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TypeError);
        expect(err).not.toBeInstanceOf(GatewayTimeoutException);
      }
    });
  });
});
