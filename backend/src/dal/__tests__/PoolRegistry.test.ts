import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// PoolRegistry unit tests
//
// KHÔNG connect đến PostgreSQL thật — mock pg.Pool
// Chỉ test routing logic và tier selection.
//
// Integration test (cần DB thật) nằm ở __tests__/integration/.
// ============================================================

// Mock toàn bộ module pg trước khi import PoolRegistry
vi.mock('pg', () => {
  const MockPool = vi.fn(() => ({
    connect: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
  }));
  return { Pool: MockPool };
});

// Mock config — tránh load .env trong test
vi.mock('../../config/env', () => ({
  config: {
    DATABASE_URL: 'postgresql://test:test@localhost/test',
    DATABASE_POOL_MAX: 200,
    DATABASE_METADATA_URL: 'postgresql://test:test@localhost/test_meta',
    DATABASE_METADATA_POOL_MAX: 20,
  },
}));

import { Pool } from 'pg';
import { PoolRegistry } from '../pool/PoolRegistry';

const VALID_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('PoolRegistry', () => {
  let registry: PoolRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new PoolRegistry();
  });

  describe('getPool — tier routing', () => {
    it('standard tenant → shared pool', () => {
      const pool = registry.getPool('basic', VALID_UUID);
      // SharedPool là pool đầu tiên được tạo trong constructor
      expect(Pool).toHaveBeenCalledTimes(2); // shared + metadata
      expect(pool).toBeDefined();
    });

    it('vip tenant không có dedicated pool → shared pool', () => {
      const sharedPool = registry.getPool('basic', VALID_UUID);
      const vipPool = registry.getPool('vip', VALID_UUID); // chưa đăng ký
      // Fallback về shared
      expect(vipPool).toBe(sharedPool);
    });

    it('vip tenant có dedicated pool → dedicated pool', () => {
      registry.registerVipPool(VALID_UUID, 'postgresql://vip:vip@localhost/vip_db');
      const pool = registry.getPool('vip', VALID_UUID);
      // Phải là pool thứ 3 (sau shared và metadata)
      expect(Pool).toHaveBeenCalledTimes(3);
      expect(pool).toBeDefined();
      // Pool vip phải khác pool shared
      const sharedPool = registry.getPool('basic');
      expect(pool).not.toBe(sharedPool);
    });
  });

  describe('registerVipPool', () => {
    it('idempotent — gọi 2 lần không tạo pool thứ 2', () => {
      registry.registerVipPool(VALID_UUID, 'postgresql://vip:vip@localhost/vip_db');
      registry.registerVipPool(VALID_UUID, 'postgresql://vip:vip@localhost/vip_db');
      // Chỉ 3 pool: shared, metadata, 1 vip (không phải 4)
      expect(Pool).toHaveBeenCalledTimes(3);
    });

    it('throw khi tenantId không phải UUID hợp lệ', () => {
      expect(() => registry.registerVipPool('invalid-id', 'postgresql://...')).toThrow(
        'invalid tenant_id format'
      );
    });
  });

  describe('getMetadataPool', () => {
    it('trả về metadata pool (khác shared pool)', () => {
      const meta = registry.getMetadataPool();
      const shared = registry.getPool('basic');
      expect(meta).not.toBe(shared);
      expect(meta).toBeDefined();
    });
  });

  describe('getStats', () => {
    it('trả về cấu trúc stats đúng', () => {
      const stats = registry.getStats();
      expect(stats).toHaveProperty('shared');
      expect(stats).toHaveProperty('metadata');
      expect(stats).toHaveProperty('vipPools');
      expect(Array.isArray(stats.vipPools)).toBe(true);
    });

    it('vipPools bao gồm pool đã đăng ký', () => {
      registry.registerVipPool(VALID_UUID, 'postgresql://vip:vip@localhost/vip_db');
      const stats = registry.getStats();
      expect(stats.vipPools).toHaveLength(1);
      expect(stats.vipPools[0].tenantId).toBe(VALID_UUID);
    });
  });

  describe('shutdown', () => {
    it('gọi end() trên tất cả pool', async () => {
      registry.registerVipPool(VALID_UUID, 'postgresql://vip:vip@localhost/vip_db');
      await registry.shutdown();

      // 3 pools: shared, metadata, vip — mỗi pool có mock end()
      const instances = vi.mocked(Pool).mock.results.map((r) => r.value);
      for (const instance of instances) {
        expect(instance.end).toHaveBeenCalled();
      }
    });
  });
});
