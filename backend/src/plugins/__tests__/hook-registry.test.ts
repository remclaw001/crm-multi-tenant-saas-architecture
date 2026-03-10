import { describe, it, expect, beforeEach } from 'vitest';
import { HookRegistryService } from '../hooks/hook-registry.service';
import type { IExecutionContext } from '../interfaces/execution-context.interface';

// ============================================================
// HookRegistryService unit tests
//
// Tests:
//  1. Priority ordering — lower number runs first
//  2. before hooks run sequentially
//  3. after hooks run sequentially
//  4. filter hooks transform data through the chain
//  5. Empty hook list = no-op
// ============================================================

// Minimal stub — tests don't need actual db/cache
const stubCtx = {} as IExecutionContext;

describe('HookRegistryService', () => {
  let registry: HookRegistryService;

  beforeEach(() => {
    registry = new HookRegistryService();
  });

  describe('register + priority ordering', () => {
    it('runs before hooks in priority order (lower = first)', async () => {
      const order: number[] = [];

      registry.register('plugin-a', { event: 'test.event', type: 'before', priority: 20 }, async () => {
        order.push(20);
      });
      registry.register('plugin-b', { event: 'test.event', type: 'before', priority: 5 }, async () => {
        order.push(5);
      });
      registry.register('plugin-c', { event: 'test.event', type: 'before', priority: 10 }, async () => {
        order.push(10);
      });

      await registry.runBefore('test.event', stubCtx, {});

      expect(order).toEqual([5, 10, 20]);
    });

    it('runs after hooks in priority order', async () => {
      const order: string[] = [];

      registry.register('plugin-x', { event: 'contact.create', type: 'after', priority: 100 }, async () => {
        order.push('x');
      });
      registry.register('plugin-y', { event: 'contact.create', type: 'after', priority: 1 }, async () => {
        order.push('y');
      });

      await registry.runAfter('contact.create', stubCtx, {});

      expect(order).toEqual(['y', 'x']);
    });
  });

  describe('before hooks', () => {
    it('runs all registered handlers', async () => {
      let callCount = 0;

      registry.register('p1', { event: 'ev', type: 'before', priority: 1 }, async () => { callCount++; });
      registry.register('p2', { event: 'ev', type: 'before', priority: 2 }, async () => { callCount++; });

      await registry.runBefore('ev', stubCtx, null);

      expect(callCount).toBe(2);
    });

    it('no-op when no handlers registered', async () => {
      await expect(registry.runBefore('unknown.event', stubCtx, {})).resolves.toBeUndefined();
    });
  });

  describe('after hooks', () => {
    it('passes correct data to handler', async () => {
      const received: unknown[] = [];
      const payload = { result: 'ok', count: 42 };

      registry.register('p1', { event: 'deal.close', type: 'after', priority: 1 }, async (_ctx, data) => {
        received.push(data);
      });

      await registry.runAfter('deal.close', stubCtx, payload);

      expect(received).toEqual([payload]);
    });
  });

  describe('filter hooks', () => {
    it('transforms data through the chain', async () => {
      registry.register('p1', { event: 'data.transform', type: 'filter', priority: 1 }, async (_ctx, data) => {
        return { ...(data as object), step1: true };
      });
      registry.register('p2', { event: 'data.transform', type: 'filter', priority: 2 }, async (_ctx, data) => {
        return { ...(data as object), step2: true };
      });

      const result = await registry.runFilter('data.transform', stubCtx, { original: true });

      expect(result).toEqual({ original: true, step1: true, step2: true });
    });

    it('passes original data through when no filters registered', async () => {
      const input = { value: 'untouched' };
      const result = await registry.runFilter('no.filters', stubCtx, input);
      expect(result).toEqual(input);
    });

    it('applies filters in priority order (lower first)', async () => {
      // First filter: multiply by 2, second: add 10
      registry.register('p1', { event: 'num.transform', type: 'filter', priority: 10 }, async (_ctx, data) => {
        return (data as number) + 10;
      });
      registry.register('p2', { event: 'num.transform', type: 'filter', priority: 1 }, async (_ctx, data) => {
        return (data as number) * 2;
      });

      // p2 (priority 1) runs first: 5 * 2 = 10, then p1 (priority 10): 10 + 10 = 20
      const result = await registry.runFilter('num.transform', stubCtx, 5);
      expect(result).toBe(20);
    });
  });

  // ============================================================
  // Per-tenant plugin gating (enabledPlugins enforcement)
  //
  // Hooks registered by a plugin must NOT fire when that plugin is
  // not in ctx.enabledPlugins.  This enforces the downgrade/offboard
  // invariant: disabled plugins produce zero side-effects even if
  // their hook handlers remain in the in-memory registry.
  // ============================================================
  describe('per-tenant plugin gating', () => {
    const ctxWith = (enabledPlugins: string[]) =>
      ({ enabledPlugins } as IExecutionContext);

    it('runBefore: skips hooks from plugins not in enabledPlugins', async () => {
      const called: string[] = [];
      registry.register('enabled-plugin', { event: 'x', type: 'before', priority: 1 }, async () => { called.push('enabled'); });
      registry.register('disabled-plugin', { event: 'x', type: 'before', priority: 2 }, async () => { called.push('disabled'); });

      await registry.runBefore('x', ctxWith(['enabled-plugin']), {});

      expect(called).toEqual(['enabled']);
    });

    it('runAfter: skips hooks from plugins not in enabledPlugins', async () => {
      const called: string[] = [];
      registry.register('plugin-a', { event: 'y', type: 'after', priority: 1 }, async () => { called.push('a'); });
      registry.register('plugin-b', { event: 'y', type: 'after', priority: 2 }, async () => { called.push('b'); });

      await registry.runAfter('y', ctxWith(['plugin-a']), {});

      expect(called).toEqual(['a']);
    });

    it('runFilter: skips filter hooks from plugins not in enabledPlugins', async () => {
      registry.register('plugin-on', { event: 'z', type: 'filter', priority: 1 }, async (_ctx, d) => ({ ...(d as object), on: true }));
      registry.register('plugin-off', { event: 'z', type: 'filter', priority: 2 }, async (_ctx, d) => ({ ...(d as object), off: true }));

      const result = await registry.runFilter('z', ctxWith(['plugin-on']), { base: true });

      expect(result).toEqual({ base: true, on: true });
      expect(result).not.toHaveProperty('off');
    });

    it('runs all hooks when all plugins are enabled', async () => {
      const called: string[] = [];
      registry.register('p1', { event: 'ev', type: 'before', priority: 1 }, async () => { called.push('p1'); });
      registry.register('p2', { event: 'ev', type: 'before', priority: 2 }, async () => { called.push('p2'); });

      await registry.runBefore('ev', ctxWith(['p1', 'p2']), {});

      expect(called).toEqual(['p1', 'p2']);
    });

    it('fires no hooks when enabledPlugins is empty', async () => {
      const called: string[] = [];
      registry.register('any-plugin', { event: 'ev', type: 'after', priority: 1 }, async () => { called.push('ran'); });

      await registry.runAfter('ev', ctxWith([]), {});

      expect(called).toHaveLength(0);
    });
  });

  describe('hook type isolation', () => {
    it('before and after hooks on same event do not interfere', async () => {
      const beforeCalls: string[] = [];
      const afterCalls: string[] = [];

      registry.register('p1', { event: 'order.create', type: 'before', priority: 1 }, async () => {
        beforeCalls.push('before');
      });
      registry.register('p2', { event: 'order.create', type: 'after', priority: 1 }, async () => {
        afterCalls.push('after');
      });

      await registry.runBefore('order.create', stubCtx, {});
      await registry.runAfter('order.create', stubCtx, {});

      expect(beforeCalls).toEqual(['before']);
      expect(afterCalls).toEqual(['after']);
    });
  });
});
