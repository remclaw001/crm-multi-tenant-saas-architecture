import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';

const mockQuery = vi.hoisted(() => vi.fn());
const mockRelease = vi.hoisted(() => vi.fn());
const mockAcquire = vi.hoisted(() => vi.fn());
const mockCacheDel = vi.hoisted(() => vi.fn());

vi.mock('../../../../dal/pool/PoolRegistry', () => ({
  PoolRegistry: vi.fn().mockImplementation(() => ({
    acquireMetadataConnection: mockAcquire,
  })),
}));

vi.mock('../../../../dal/cache/CacheManager', () => ({
  CacheManager: vi.fn().mockImplementation(() => ({
    del: mockCacheDel,
  })),
}));

import { AdminTenantsService } from '../admin-tenants.service';
import { PoolRegistry } from '../../../../dal/pool/PoolRegistry';
import { CacheManager } from '../../../../dal/cache/CacheManager';

const ROW = {
  id: 'tid', name: 'Acme', subdomain: 'acme',
  tier: 'standard', is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  plugin_count: '2',
};

describe('AdminTenantsService', () => {
  let service: AdminTenantsService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAcquire.mockResolvedValue({ query: mockQuery, release: mockRelease });
    mockCacheDel.mockResolvedValue(undefined);
    service = new AdminTenantsService(
      new (PoolRegistry as any)(),
      new (CacheManager as any)(),
    );
  });

  describe('list', () => {
    it('returns paginated tenants excluding system', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockResolvedValueOnce({ rows: [ROW] });

      const result = await service.list({ page: 1, limit: 20 });
      expect(result.total).toBe(1);
      expect(result.data[0].plan).toBe('standard');
      expect(result.data[0].status).toBe('active');
      expect(result.data[0].pluginCount).toBe(2);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when tenant not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await expect(service.findOne('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('sets is_active to false', async () => {
      await service.softDelete('tid');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('is_active = false'),
        ['tid'],
      );
    });
  });
});
