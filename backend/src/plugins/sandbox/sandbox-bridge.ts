// ============================================================
// SandboxBridge — restricted API surface for plugin scripts
//
// Defines the ONLY operations available to a plugin script
// running inside a V8 isolate. Everything else (require, process,
// fs, Buffer, global Node.js APIs) is blocked by the isolate.
//
// Bridge methods:
//   db.query(table, where?)   — RLS-scoped SELECT, max 100 rows
//   db.count(table, where?)   — RLS-scoped COUNT aggregate
//   cache.get(resource, id)   — tenant-scoped Redis get
//   cache.set(resource, id, value, ttl) — tenant-scoped Redis set
//   log(message, data?)       — structured log (no direct console)
//   tenantId, userId, requestId — read-only metadata
//
// Query limit (50/request) is enforced automatically by
// QueryInterceptor.increment(true) on every DB connection acquire.
// ============================================================

import type { IExecutionContext } from '../interfaces/execution-context.interface';

// ── Public interface ───────────────────────────────────────────

export interface SandboxDbBridge {
  /** RLS-scoped SELECT. Max 100 rows. Enforces 50-query limit. */
  query(table: string, where?: Record<string, unknown>): Promise<unknown[]>;
  /** RLS-scoped COUNT aggregate. Enforces 50-query limit. */
  count(table: string, where?: Record<string, unknown>): Promise<number>;
}

export interface SandboxCacheBridge {
  get<T = unknown>(resource: string, id: string): Promise<T | null>;
  set(resource: string, id: string, value: unknown, ttlSeconds: number): Promise<void>;
}

/**
 * Full API surface exposed to plugin scripts inside the V8 isolate.
 * Built from IExecutionContext by buildSandboxBridge().
 */
export interface SandboxBridge {
  readonly tenantId: string;
  readonly userId: string;
  readonly requestId: string;
  readonly db: SandboxDbBridge;
  readonly cache: SandboxCacheBridge;
  readonly log: (message: string, data?: Record<string, unknown>) => void;
}

// ── Factory ────────────────────────────────────────────────────

/**
 * Build a SandboxBridge from an IExecutionContext.
 *
 * The bridge exposes a minimal, safe subset of the execution context.
 * - DB queries run through Knex (RLS-scoped, QueryCounter-limited)
 * - Cache operations use the tenant-scoped CacheManager
 * - No access to raw pool connections or internal services
 */
export function buildSandboxBridge(ctx: IExecutionContext): SandboxBridge {
  return {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    requestId: ctx.requestId,

    db: {
      async query(
        table: string,
        where: Record<string, unknown> = {},
      ): Promise<unknown[]> {
        // QueryInterceptor.increment(true) fires on every connection acquire →
        // automatically enforces the 50-query limit with QueryLimitExceededError
        const qb = ctx.db.db(table).select('*');
        if (Object.keys(where).length > 0) {
          qb.where(where);
        }
        return qb.limit(100) as Promise<unknown[]>;
      },

      async count(
        table: string,
        where: Record<string, unknown> = {},
      ): Promise<number> {
        const qb = ctx.db.db(table).count<{ count: string }>('* as count');
        if (Object.keys(where).length > 0) {
          qb.where(where);
        }
        const row = await qb.first();
        return parseInt(row?.count ?? '0', 10);
      },
    },

    cache: {
      async get<T = unknown>(resource: string, id: string): Promise<T | null> {
        return ctx.cache.get<T>(resource, id);
      },

      async set(
        resource: string,
        id: string,
        value: unknown,
        ttlSeconds: number,
      ): Promise<void> {
        return ctx.cache.set(resource, id, value, ttlSeconds);
      },
    },

    log: (message: string, data?: Record<string, unknown>): void => {
      // Route through console — in production, a Pino logger would be bridged
      console.log(
        JSON.stringify({
          plugin_log: true,
          message,
          data: data ?? {},
          requestId: ctx.requestId,
        }),
      );
    },
  };
}
