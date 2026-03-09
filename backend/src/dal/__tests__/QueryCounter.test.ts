import { describe, it, expect } from 'vitest';
import { TenantContext } from '../context/TenantContext';
import { QueryCounter, QueryLimitExceededError, QUERY_LIMIT } from '../middleware/QueryCounter';

// ============================================================
// QueryCounter unit tests
//
// Verify:
// 1. Đếm đúng số query trong context
// 2. throwOnLimit=true throw đúng khi vượt limit
// 3. throwOnLimit=false không throw dù vượt limit
// 4. isExceeded() phản ánh đúng trạng thái
// ============================================================

describe('QueryCounter', () => {
  it('bắt đầu từ 0 trong context mới', () => {
    TenantContext.run({ tenantId: 'x', tenantTier: 'basic' }, () => {
      expect(QueryCounter.get()).toBe(0);
    });
  });

  it('increment tăng đúng số lần', () => {
    TenantContext.run({ tenantId: 'x', tenantTier: 'basic' }, () => {
      QueryCounter.increment();
      QueryCounter.increment();
      QueryCounter.increment();
      expect(QueryCounter.get()).toBe(3);
    });
  });

  it('increment trả về giá trị sau khi tăng', () => {
    TenantContext.run({ tenantId: 'x', tenantTier: 'basic' }, () => {
      expect(QueryCounter.increment()).toBe(1);
      expect(QueryCounter.increment()).toBe(2);
    });
  });

  describe('throwOnLimit', () => {
    it('không throw khi ≤ QUERY_LIMIT', () => {
      TenantContext.run({ tenantId: 'x', tenantTier: 'basic' }, () => {
        for (let i = 0; i < QUERY_LIMIT; i++) {
          expect(() => QueryCounter.increment(true)).not.toThrow();
        }
        expect(QueryCounter.get()).toBe(QUERY_LIMIT);
      });
    });

    it('throw QueryLimitExceededError khi vượt quá QUERY_LIMIT với throwOnLimit=true', () => {
      TenantContext.run({ tenantId: 'x', tenantTier: 'basic' }, () => {
        // Điền đủ 50 query
        for (let i = 0; i < QUERY_LIMIT; i++) {
          QueryCounter.increment(false);
        }
        // Query thứ 51 → throw
        expect(() => QueryCounter.increment(true)).toThrow(QueryLimitExceededError);
      });
    });

    it('QueryLimitExceededError chứa thông tin đúng', () => {
      TenantContext.run({ tenantId: 'x', tenantTier: 'basic' }, () => {
        for (let i = 0; i < QUERY_LIMIT; i++) {
          QueryCounter.increment(false);
        }
        try {
          QueryCounter.increment(true);
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(QueryLimitExceededError);
          const e = err as QueryLimitExceededError;
          expect(e.actual).toBe(QUERY_LIMIT + 1);
          expect(e.limit).toBe(QUERY_LIMIT);
          expect(e.message).toContain('50');
        }
      });
    });

    it('không throw khi throwOnLimit=false dù vượt limit', () => {
      TenantContext.run({ tenantId: 'x', tenantTier: 'basic' }, () => {
        for (let i = 0; i <= QUERY_LIMIT + 10; i++) {
          expect(() => QueryCounter.increment(false)).not.toThrow();
        }
        expect(QueryCounter.get()).toBeGreaterThan(QUERY_LIMIT);
      });
    });
  });

  describe('isExceeded', () => {
    it('false khi chưa đạt limit', () => {
      TenantContext.run({ tenantId: 'x', tenantTier: 'basic' }, () => {
        for (let i = 0; i < QUERY_LIMIT; i++) {
          QueryCounter.increment();
        }
        expect(QueryCounter.isExceeded()).toBe(false); // exactly at limit = not exceeded
      });
    });

    it('true khi vượt limit', () => {
      TenantContext.run({ tenantId: 'x', tenantTier: 'basic' }, () => {
        for (let i = 0; i <= QUERY_LIMIT; i++) {
          QueryCounter.increment(false);
        }
        expect(QueryCounter.isExceeded()).toBe(true);
      });
    });
  });

  it('QUERY_LIMIT là 50 theo spec', () => {
    expect(QUERY_LIMIT).toBe(50);
  });
});
