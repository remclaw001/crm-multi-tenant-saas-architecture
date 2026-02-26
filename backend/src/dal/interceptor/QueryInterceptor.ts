import Knex from 'knex';
import type { Knex as KnexType } from 'knex';
import { TenantContext } from '../context/TenantContext';
import { QueryCounter } from '../middleware/QueryCounter';

// ============================================================
// QueryInterceptor — Knex-level tenant scope enforcement
//
// Hook vào Knex internal: acquireConnection / releaseConnection
//
// Mỗi lần Knex lấy connection từ pool:
//   1. SET app.tenant_id = '<current-tenant>' → kích hoạt RLS
//   2. QueryCounter.increment() → theo dõi số query/request
//
// Mỗi lần Knex trả connection về pool:
//   3. SET app.tenant_id = '' → ngăn context leak
//
// Tại sao monkey-patch acquireConnection?
//   Knex không expose "before query" hook sạch ở tầng connection.
//   acquireConnection là điểm duy nhất intercept đúng thời điểm
//   trước khi connection được dùng cho query.
//
// RLS (PostgreSQL) là hard boundary — QueryInterceptor là
// application-level safety net bổ sung.
// ============================================================

/**
 * Validate tenant_id format — UUID only.
 * Ngăn SQL injection trước khi interpolate vào SET command.
 * (Knex parameterized query không áp dụng được cho SET command)
 */
function assertValidUuid(id: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(`QueryInterceptor: invalid tenant_id format: "${id}"`);
  }
}

/**
 * Áp dụng tenant interceptor lên một Knex instance.
 * Gọi một lần duy nhất khi khởi tạo app.
 */
export function applyQueryInterceptor(knex: KnexType): void {
  // Truy cập Knex internal client — đây là API internal, không public
  // nhưng ổn định qua các version Knex 2.x / 3.x
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = knex.client as any;

  const _acquire = client.acquireConnection.bind(client);
  const _release = client.releaseConnection.bind(client);

  // ── acquireConnection ─────────────────────────────────
  client.acquireConnection = async function (this: unknown) {
    const connection = await _acquire();

    const tenantId = TenantContext.getTenantId();
    if (tenantId) {
      assertValidUuid(tenantId);
      // SET (session-level) — tồn tại suốt thời gian dùng connection
      await connection.query(`SET "app.tenant_id" = '${tenantId}'`);
    }

    // Đếm query và enforce 50-query hard limit (Phase 6 Sandbox).
    // Throws QueryLimitExceededError khi vượt QUERY_LIMIT.
    // Error được catch bởi IsolatedSandboxService và mapped thành
    // HTTP 429 / sandbox violation metric.
    QueryCounter.increment(true);

    return connection;
  };

  // ── releaseConnection ─────────────────────────────────
  client.releaseConnection = async function (this: unknown, connection: unknown) {
    try {
      // Defense-in-depth: reset trước khi trả về pool
      // (PoolRegistry.acquireConnection cũng làm điều này)
      await (connection as { query: (sql: string) => Promise<void> }).query(
        `SET "app.tenant_id" = ''`
      );
    } catch {
      // Connection có thể bị broken sau error — pool sẽ auto-discard
    }
    return _release(connection);
  };
}

/**
 * Tạo một Knex instance với tenant interceptor đã được áp dụng.
 *
 * Đây là factory function duy nhất để tạo Knex trong app.
 * Mỗi app instance chỉ cần một Knex instance duy nhất.
 */
export function createKnex(connectionString: string, poolMax: number): KnexType {
  const knex = Knex({
    client: 'postgresql',
    connection: connectionString,
    pool: {
      min: 2,
      max: poolMax,
      // Reset tenant context khi connection mới được TẠO
      // (Defense layer 1 — bổ sung cho interceptor's release hook)
      afterCreate(
        conn: { query: (sql: string, cb: (err: Error | null) => void) => void },
        done: (err: Error | null, conn: unknown) => void
      ) {
        conn.query("SELECT set_config('app.tenant_id', NULL, false)", (err) => {
          done(err, conn);
        });
      },
    },
  });

  applyQueryInterceptor(knex);

  return knex;
}
