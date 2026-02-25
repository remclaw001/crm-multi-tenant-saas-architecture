import { TenantContext } from '../context/TenantContext';

// ============================================================
// QueryCounter — đếm số DB query mỗi request
//
// Dữ liệu được lưu trong TenantContext (AsyncLocalStorage),
// nên counter hoàn toàn isolated theo từng request — không cần
// lock hay shared state.
//
// Phase 6 (Sandbox Engine) sẽ gọi QueryCounter.increment(true)
// để throw khi plugin vượt giới hạn 50 queries/request.
// ============================================================

/** Số query tối đa cho phép mỗi request (sandbox hard limit). */
export const QUERY_LIMIT = 50;

export const QueryCounter = {
  /**
   * Ghi nhận một query đã được thực hiện.
   * @param throwOnLimit — nếu true, throw khi vượt QUERY_LIMIT
   * @returns số query hiện tại sau khi tăng
   */
  increment(throwOnLimit = false): number {
    const count = TenantContext.incrementQueryCount();
    if (throwOnLimit && count > QUERY_LIMIT) {
      throw new QueryLimitExceededError(count, QUERY_LIMIT);
    }
    return count;
  },

  /** Trả về số query đã thực hiện trong request hiện tại. */
  get(): number {
    return TenantContext.getQueryCount();
  },

  /** Kiểm tra xem giới hạn có bị vượt không. */
  isExceeded(): boolean {
    return TenantContext.getQueryCount() > QUERY_LIMIT;
  },
} as const;

/** Thrown khi plugin vượt quá số query cho phép mỗi request. */
export class QueryLimitExceededError extends Error {
  constructor(
    readonly actual: number,
    readonly limit: number
  ) {
    super(
      `Query limit exceeded: ${actual}/${limit} queries in this request. ` +
        'Plugin must stay within the 50-query budget per request.'
    );
    this.name = 'QueryLimitExceededError';
  }
}
