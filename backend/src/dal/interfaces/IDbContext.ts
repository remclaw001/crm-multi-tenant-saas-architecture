import type { Knex } from 'knex';

// ============================================================
// IDbContext — L4 abstraction over the database connection
//
// Business logic (L3) nhận IDbContext qua DI container (Phase 7).
// Không bao giờ import Pool, PoolClient, hay raw Knex trực tiếp
// từ L3 — luôn đi qua interface này để tuân thủ DIP.
//
// QueryInterceptor đảm bảo mọi query qua IDbContext.db đều
// tự động được scoped theo tenant_id từ TenantContext.
// ============================================================

export interface IDbContext {
  /**
   * Knex instance đã được intercepted — mọi query tự động
   * có tenant scope thông qua RLS (SET app.tenant_id).
   *
   * Dùng như query builder bình thường:
   *   await ctx.db('users').where({ email }).first()
   */
  readonly db: Knex;

  /**
   * Chạy fn bên trong một database transaction.
   * app.tenant_id được set tự động cho toàn bộ transaction.
   *
   *   await ctx.transaction(async (trx) => {
   *     await trx('users').insert({ ... });
   *     await trx('roles').insert({ ... });
   *   });
   */
  transaction<T>(fn: (trx: Knex.Transaction) => Promise<T>): Promise<T>;
}
