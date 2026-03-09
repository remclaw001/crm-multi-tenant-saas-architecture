import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';

const mockQuery = vi.hoisted(() => vi.fn());
const mockRelease = vi.hoisted(() => vi.fn());
const mockAcquire = vi.hoisted(() => vi.fn());
const mockDelForTenant = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../../../dal/pool/PoolRegistry', () => ({
  PoolRegistry: vi.fn().mockImplementation(() => ({
    acquireMetadataConnection: mockAcquire,
  })),
}));

vi.mock('../../../../dal/cache/CacheManager', () => ({
  CacheManager: vi.fn().mockImplementation(() => ({
    delForTenant: mockDelForTenant,
  })),
}));

import { AdminTenantsService } from '../admin-tenants.service';
import { PoolRegistry } from '../../../../dal/pool/PoolRegistry';
import { CacheManager } from '../../../../dal/cache/CacheManager';

const ROW = {
  id: 'tid', name: 'Acme', subdomain: 'acme',
  tier: 'basic', is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  plugin_count: '2',
};

describe('AdminTenantsService', () => {
  let service: AdminTenantsService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAcquire.mockResolvedValue({ query: mockQuery, release: mockRelease });
    service = new AdminTenantsService(new (PoolRegistry as any)(), new (CacheManager as any)());
  });

  describe('list', () => {
    it('returns paginated tenants excluding system', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockResolvedValueOnce({ rows: [ROW] });

      const result = await service.list({ page: 1, limit: 20 });
      expect(result.total).toBe(1);
      expect(result.data[0].plan).toBe('basic');
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
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'tid' }] });
      await service.softDelete('tid');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('is_active = false'),
        ['tid'],
      );
    });

    it('throws NotFoundException when tenant not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await expect(service.softDelete('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update — tier change plugin delta', () => {
    it('basic→premium: enables analytics and customer-care', async () => {
      // BEGIN
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // 1st query: SELECT tier (current = basic)
      mockQuery.mockResolvedValueOnce({ rows: [{ tier: 'basic' }] });
      // 2nd query: UPDATE tenants RETURNING ...
      mockQuery.mockResolvedValueOnce({ rows: [{ ...ROW, tier: 'premium', plugin_count: '3' }] });
      // 3rd query: INSERT tenant_plugins (toEnable)
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // COMMIT
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await service.update('tid', { plan: 'premium' });

      // Verify the INSERT to enable plugins was called
      const insertCall = mockQuery.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('INSERT INTO tenant_plugins'),
      );
      expect(insertCall).toBeDefined();
      const enabledPlugins: string[] = insertCall![1][1];
      expect(enabledPlugins).toContain('customer-care');
      expect(enabledPlugins).toContain('analytics');
      expect(enabledPlugins).not.toContain('customer-data'); // already in basic

      // Cache should be invalidated
      expect(mockDelForTenant).toHaveBeenCalledWith('tid', 'tenant-config', 'enabled-plugins');
    });

    it('enterprise→basic: disables marketing', async () => {
      // BEGIN
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // 1st query: SELECT tier (current = enterprise)
      mockQuery.mockResolvedValueOnce({ rows: [{ tier: 'enterprise' }] });
      // 2nd query: UPDATE tenants RETURNING ...
      mockQuery.mockResolvedValueOnce({ rows: [{ ...ROW, tier: 'basic', plugin_count: '1' }] });
      // 3rd query: UPDATE tenant_plugins (toDisable)
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // COMMIT
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await service.update('tid', { plan: 'basic' });

      // Verify the UPDATE to disable plugins was called
      const disableCall = mockQuery.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('is_enabled = false'),
      );
      expect(disableCall).toBeDefined();
      const disabledPlugins: string[] = disableCall![1][1];
      expect(disabledPlugins).toContain('marketing');
      expect(disabledPlugins).toContain('customer-care');
      expect(disabledPlugins).toContain('analytics');
      expect(disabledPlugins).not.toContain('customer-data'); // in both basic and enterprise

      // Cache should be invalidated
      expect(mockDelForTenant).toHaveBeenCalledWith('tid', 'tenant-config', 'enabled-plugins');
    });

    it('same tier update: no plugin changes', async () => {
      // BEGIN
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // 1st query: SELECT tier (current = basic)
      mockQuery.mockResolvedValueOnce({ rows: [{ tier: 'basic' }] });
      // 2nd query: UPDATE tenants RETURNING ... (updating name only)
      mockQuery.mockResolvedValueOnce({ rows: [{ ...ROW, name: 'New Name' }] });
      // COMMIT
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await service.update('tid', { name: 'New Name' });

      // No INSERT or UPDATE to tenant_plugins should have been called
      const pluginInsert = mockQuery.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('INSERT INTO tenant_plugins'),
      );
      const pluginUpdate = mockQuery.mock.calls.find(
        (args) =>
          typeof args[0] === 'string' &&
          args[0].includes('UPDATE tenant_plugins'),
      );
      expect(pluginInsert).toBeUndefined();
      expect(pluginUpdate).toBeUndefined();

      // Cache should NOT be invalidated
      expect(mockDelForTenant).not.toHaveBeenCalled();
    });

    it('updating plan to same tier: no plugin changes', async () => {
      // BEGIN
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // 1st query: SELECT tier (current = basic)
      mockQuery.mockResolvedValueOnce({ rows: [{ tier: 'basic' }] });
      // 2nd query: UPDATE tenants RETURNING ...
      mockQuery.mockResolvedValueOnce({ rows: [{ ...ROW, tier: 'basic' }] });
      // COMMIT
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await service.update('tid', { plan: 'basic' });

      // No INSERT or UPDATE to tenant_plugins
      const pluginInsert = mockQuery.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('INSERT INTO tenant_plugins'),
      );
      expect(pluginInsert).toBeUndefined();
      expect(mockDelForTenant).not.toHaveBeenCalled();
    });
  });
});
