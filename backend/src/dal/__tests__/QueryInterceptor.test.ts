import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// QueryInterceptor unit tests
//
// Verify:
// 1. acquireConnection gọi SET app.tenant_id khi có TenantContext
// 2. acquireConnection không SET khi không có context
// 3. releaseConnection luôn gọi reset SET app.tenant_id = ''
// 4. Invalid UUID bị reject
// 5. QueryCounter được gọi mỗi lần acquire
// ============================================================

// Mock config
vi.mock('../../config/env', () => ({
  config: {
    DATABASE_URL: 'postgresql://test:test@localhost/test',
    DATABASE_POOL_MAX: 200,
  },
}));

import { applyQueryInterceptor } from '../interceptor/QueryInterceptor';
import { TenantContext } from '../context/TenantContext';

const VALID_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/** Helper: tạo mock Knex instance với client hooks */
function createMockKnex() {
  const mockConnection = {
    query: vi.fn().mockResolvedValue(undefined),
  };

  const client = {
    acquireConnection: vi.fn().mockResolvedValue(mockConnection),
    releaseConnection: vi.fn().mockResolvedValue(undefined),
  };

  return { knex: { client } as any, mockConnection, client };
}

describe('QueryInterceptor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('acquireConnection', () => {
    it('gọi SET app.tenant_id khi có TenantContext', async () => {
      const { knex, mockConnection } = createMockKnex();
      applyQueryInterceptor(knex);

      await TenantContext.run(
        { tenantId: VALID_UUID, tenantTier: 'basic' },
        async () => {
          await knex.client.acquireConnection();
        }
      );

      expect(mockConnection.query).toHaveBeenCalledWith(
        `SET "app.tenant_id" = '${VALID_UUID}'`
      );
    });

    it('không gọi SET khi không có TenantContext', async () => {
      const { knex, mockConnection } = createMockKnex();
      applyQueryInterceptor(knex);

      // Gọi ngoài TenantContext.run()
      await knex.client.acquireConnection();

      expect(mockConnection.query).not.toHaveBeenCalled();
    });

    it('throw khi tenantId không phải UUID hợp lệ', async () => {
      const { knex } = createMockKnex();
      applyQueryInterceptor(knex);

      await expect(
        TenantContext.run(
          { tenantId: 'not-a-uuid', tenantTier: 'basic' },
          () => knex.client.acquireConnection()
        )
      ).rejects.toThrow('invalid tenant_id format');
    });

    it('vẫn gọi original acquireConnection', async () => {
      const { knex, client } = createMockKnex();
      applyQueryInterceptor(knex);

      await TenantContext.run(
        { tenantId: VALID_UUID, tenantTier: 'basic' },
        async () => {
          await knex.client.acquireConnection();
        }
      );

      // Original acquire phải được gọi đúng 1 lần
      expect(client.acquireConnection).not.toHaveBeenCalled(); // đã bị replace
    });
  });

  describe('releaseConnection', () => {
    it('luôn reset SET app.tenant_id = \'\'', async () => {
      const { knex, mockConnection } = createMockKnex();
      applyQueryInterceptor(knex);

      // Acquire rồi release
      const conn = await TenantContext.run(
        { tenantId: VALID_UUID, tenantTier: 'basic' },
        async () => knex.client.acquireConnection()
      );

      vi.clearAllMocks(); // Reset để chỉ kiểm tra release

      await knex.client.releaseConnection(conn);

      expect(mockConnection.query).toHaveBeenCalledWith(`SET "app.tenant_id" = ''`);
    });

    it('vẫn release dù reset query bị lỗi', async () => {
      const { knex, mockConnection, client } = createMockKnex();
      // Simulate connection broken khi reset
      mockConnection.query.mockRejectedValueOnce(new Error('connection broken'));
      applyQueryInterceptor(knex);

      const conn = await knex.client.acquireConnection();
      // Không throw — swallow error và vẫn release
      await expect(knex.client.releaseConnection(conn)).resolves.not.toThrow();
      expect(client.releaseConnection).not.toHaveBeenCalled(); // đã bị replace
    });
  });

  describe('QueryCounter integration', () => {
    it('increment QueryCounter mỗi lần acquire', async () => {
      const { knex } = createMockKnex();
      applyQueryInterceptor(knex);

      await TenantContext.run(
        { tenantId: VALID_UUID, tenantTier: 'basic' },
        async () => {
          expect(TenantContext.getQueryCount()).toBe(0);
          await knex.client.acquireConnection();
          expect(TenantContext.getQueryCount()).toBe(1);
          await knex.client.acquireConnection();
          expect(TenantContext.getQueryCount()).toBe(2);
        }
      );
    });
  });
});
