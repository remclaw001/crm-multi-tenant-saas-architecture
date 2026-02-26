// ============================================================
// IsolatedSandboxService — V8 isolate wrapper for plugin scripts
//
// Runs untrusted plugin code in a true V8 isolate (separate heap).
// Built-in plugin cores (CustomerData, Analytics…) are trusted NestJS
// services and run via SandboxService (host process, timeout only).
// IsolatedSandboxService targets EXTERNAL/THIRD-PARTY plugins loaded
// as JavaScript code strings from the tenant_plugins config.
//
// Hard limits enforced per call:
//   Memory  → 50 MB    (new ivm.Isolate({ memoryLimit: 50 }))
//   Timeout → 5 000 ms (script.run(ctx, { timeout: 5000 }))
//   Queries → 50/req   (QueryInterceptor.increment(true) in bridge)
//
// Context bridge:
//   Host functions are wrapped in ivm.Reference objects and injected
//   into the isolate as __db_query, __db_count, __cache_get, __cache_set,
//   __log. A setup script creates friendly ctx.db / ctx.cache / ctx.log
//   wrappers inside the isolate using applySyncPromise().
//
// Security:
//   - No require / process / fs / Buffer in the isolate
//   - No shared heap with the host process
//   - V8 kills the isolate on memory breach
//   - Isolate.dispose() always called in finally (prevents leaks)
//
// Metrics recorded per execution:
//   crm_sandbox_execution_duration_seconds{result}
//   crm_sandbox_violations_total{limit_type}
// ============================================================

import ivm from 'isolated-vm';
import {
  Injectable,
  GatewayTimeoutException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { QueryLimitExceededError } from '../../dal/middleware/QueryCounter';
import { PrometheusService } from '../../observability/metrics/prometheus.service';
import type { SandboxBridge } from './sandbox-bridge';

// ── Bridge setup script (runs inside every isolate) ────────────
// Rebuilds async-friendly db/cache/log wrappers from the raw References
// injected by the host. Uses applySyncPromise() to bridge async host ops
// into the isolate's synchronous-looking async/await surface.
const BRIDGE_SETUP_SCRIPT = /* javascript */ `
'use strict';

const db = {
  async query(table, where) {
    const json = await __db_query.applySyncPromise(
      undefined,
      [String(table), JSON.stringify(where ?? {})],
    );
    return JSON.parse(json);
  },
  async count(table, where) {
    return Number(
      await __db_count.applySyncPromise(
        undefined,
        [String(table), JSON.stringify(where ?? {})],
      ),
    );
  },
};

const cache = {
  async get(resource, id) {
    const json = await __cache_get.applySyncPromise(
      undefined,
      [String(resource), String(id)],
    );
    return json !== null ? JSON.parse(json) : null;
  },
  async set(resource, id, value, ttl) {
    await __cache_set.applySyncPromise(
      undefined,
      [String(resource), String(id), JSON.stringify(value), Number(ttl)],
    );
  },
};

const log = (message, data) => {
  __log.applySync(
    undefined,
    [String(message), data !== undefined ? JSON.stringify(data) : null],
  );
};

// Plugin-facing context object — mirrors IExecutionContext's public API
const ctx = {
  tenantId: __tenantId,
  userId:   __userId,
  requestId: __requestId,
  db,
  cache,
  log,
};
`;

// ── Service ────────────────────────────────────────────────────

@Injectable()
export class IsolatedSandboxService {
  private readonly logger = new Logger(IsolatedSandboxService.name);

  constructor(private readonly prometheus: PrometheusService) {}

  /**
   * Execute an untrusted plugin script inside a V8 isolate.
   *
   * @param script   — JavaScript code. Has access to a `ctx` object with
   *                   tenantId, userId, requestId, db, cache, log.
   *                   The final expression value is returned.
   * @param bridge   — Host-side API implementations injected via References.
   * @param options  — Override for timeoutMs (default 5000) and
   *                   memoryLimitMb (default 50).
   *
   * @throws GatewayTimeoutException       — script exceeded timeoutMs
   * @throws InternalServerErrorException  — script exceeded memoryLimitMb
   * @throws QueryLimitExceededError       — script issued > 50 DB queries
   */
  async runScript<T = unknown>(
    script: string,
    bridge: SandboxBridge,
    options: { timeoutMs?: number; memoryLimitMb?: number } = {},
  ): Promise<T> {
    const timeoutMs = options.timeoutMs ?? 5_000;
    const memoryLimitMb = options.memoryLimitMb ?? 50;
    const startMs = Date.now();

    // Each call gets its own isolate — independent heap, no state sharing
    const isolate = new ivm.Isolate({ memoryLimit: memoryLimitMb });

    try {
      const context = await isolate.createContext();
      const jail = context.global;

      // ── Inject primitive metadata (copied into isolate heap) ─
      await jail.set('__tenantId', bridge.tenantId, { copy: true });
      await jail.set('__userId', bridge.userId, { copy: true });
      await jail.set('__requestId', bridge.requestId, { copy: true });

      // ── Inject host References ──────────────────────────────
      // References allow the isolate to call host async functions.
      // JSON is used for data transfer (isolate heap ↔ host heap).

      await jail.set(
        '__db_query',
        new ivm.Reference(
          async (table: string, whereJson: string): Promise<string> => {
            const rows = await bridge.db.query(
              table,
              JSON.parse(whereJson) as Record<string, unknown>,
            );
            return JSON.stringify(rows);
          },
        ),
      );

      await jail.set(
        '__db_count',
        new ivm.Reference(
          async (table: string, whereJson: string): Promise<number> => {
            return bridge.db.count(
              table,
              JSON.parse(whereJson) as Record<string, unknown>,
            );
          },
        ),
      );

      await jail.set(
        '__cache_get',
        new ivm.Reference(
          async (resource: string, id: string): Promise<string | null> => {
            const val = await bridge.cache.get(resource, id);
            return val !== null ? JSON.stringify(val) : null;
          },
        ),
      );

      await jail.set(
        '__cache_set',
        new ivm.Reference(
          async (
            resource: string,
            id: string,
            valueJson: string,
            ttl: number,
          ): Promise<void> => {
            await bridge.cache.set(
              resource,
              id,
              JSON.parse(valueJson),
              ttl,
            );
          },
        ),
      );

      await jail.set(
        '__log',
        new ivm.Reference(
          (message: string, dataJson: string | null): void => {
            bridge.log(
              message,
              dataJson
                ? (JSON.parse(dataJson) as Record<string, unknown>)
                : undefined,
            );
          },
        ),
      );

      // ── Run bridge setup (create db / cache / log / ctx wrappers) ─
      // This is TRUSTED code — no timeout needed here.
      await context.eval(BRIDGE_SETUP_SCRIPT);

      // ── Compile + run the plugin script ─────────────────────
      // Wrapped in an async IIFE so the script can use top-level await.
      // `promise: true` unwraps the returned Promise automatically.
      const wrappedCode = `(async function __plugin(ctx) {\n${script}\n})(ctx)`;
      const compiled = await isolate.compileScript(wrappedCode);
      const result = await compiled.run(context, {
        timeout: timeoutMs,
        promise: true,
      }) as T;

      // ── Record success metric ────────────────────────────────
      const durationS = (Date.now() - startMs) / 1000;
      this.prometheus.sandboxExecutionDuration.observe(
        { result: 'success' },
        durationS,
      );

      return result;

    } catch (err) {
      return this.handleError(err as Error, startMs);

    } finally {
      // Always dispose — releases isolate heap and prevents leaks
      isolate.dispose();
    }
  }

  // ── Error mapping ─────────────────────────────────────────────

  private handleError(err: Error, startMs: number): never {
    const durationS = (Date.now() - startMs) / 1000;

    if (this.isTimeoutError(err)) {
      this.prometheus.sandboxViolationsTotal.inc({ limit_type: 'timeout' });
      this.prometheus.sandboxExecutionDuration.observe(
        { result: 'timeout' },
        durationS,
      );
      this.logger.warn(`[sandbox] Plugin timeout after ${durationS.toFixed(2)}s`);
      throw new GatewayTimeoutException(
        'Plugin execution timeout (5 s limit exceeded)',
      );
    }

    if (this.isMemoryError(err)) {
      this.prometheus.sandboxViolationsTotal.inc({ limit_type: 'memory' });
      this.prometheus.sandboxExecutionDuration.observe(
        { result: 'memory_exceeded' },
        durationS,
      );
      this.logger.warn(`[sandbox] Plugin memory limit exceeded: ${err.message}`);
      throw new InternalServerErrorException(
        'Plugin exceeded memory limit (50 MB)',
      );
    }

    if (err instanceof QueryLimitExceededError) {
      this.prometheus.sandboxViolationsTotal.inc({ limit_type: 'query_limit' });
      this.prometheus.sandboxExecutionDuration.observe(
        { result: 'query_limit' },
        durationS,
      );
      this.logger.warn(`[sandbox] Query limit exceeded: ${err.message}`);
      throw err; // preserve QueryLimitExceededError for upstream handler
    }

    // Unknown error — propagate as-is, still record duration
    this.prometheus.sandboxExecutionDuration.observe(
      { result: 'error' },
      durationS,
    );
    throw err;
  }

  private isTimeoutError(err: Error): boolean {
    return /Script execution timed out/i.test(err.message ?? '');
  }

  private isMemoryError(err: Error): boolean {
    return /memory limit|Isolate was disposed/i.test(err.message ?? '');
  }
}
