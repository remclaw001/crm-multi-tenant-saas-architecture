import { describe, it, expect } from 'vitest';
import { GatewayTimeoutException } from '@nestjs/common';
import { SandboxService } from '../sandbox/sandbox.service';

// ============================================================
// SandboxService unit tests
//
// Tests:
//  1. Normal execution returns value
//  2. Slow function exceeds timeout → GatewayTimeoutException
//  3. Short timeout overrides the default
//  4. Rejected function propagates the error
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
