import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';

const mockQuery = vi.hoisted(() => vi.fn());
const mockRelease = vi.hoisted(() => vi.fn());
const mockAcquire = vi.hoisted(() => vi.fn());
const mockDelForTenant = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockPublishNotification = vi.hoisted(() => vi.fn());

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

vi.mock('../../../../workers/amqp/amqp-publisher.service', () => ({
  AmqpPublisher: vi.fn().mockImplementation(() => ({
    publishNotification: mockPublishNotification,
  })),
}));

import { AdminTenantsService } from '../admin-tenants.service';
import { PoolRegistry } from '../../../../dal/pool/PoolRegistry';
import { CacheManager } from '../../../../dal/cache/CacheManager';
import { AmqpPublisher } from '../../../../workers/amqp/amqp-publisher.service';

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
    service = new AdminTenantsService(
      new (PoolRegistry as any)(),
      new (CacheManager as any)(),
      new (AmqpPublisher as any)(),
    );
  });

  describe('create — AMQP welcome event', () => {
    const setupCreateMocks = () => {
      // BEGIN
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // INSERT INTO tenants RETURNING ...
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'tid', name: 'Acme', subdomain: 'acme',
          tier: 'basic', is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
      });
      // INSERT INTO tenant_plugins (customer-data)
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // COMMIT
      mockQuery.mockResolvedValueOnce({ rows: [] });
    };

    it('publishes welcome notification when adminEmail is provided', async () => {
      setupCreateMocks();

      await service.create({ name: 'Acme', subdomain: 'acme', plan: 'basic', adminEmail: 'admin@acme.com' });

      // Allow the fire-and-forget microtask to execute
      await Promise.resolve();

      expect(mockPublishNotification).toHaveBeenCalledOnce();
      const call = mockPublishNotification.mock.calls[0][0];
      expect(call.tenantId).toBe('tid');
      expect(call.channel).toBe('email');
      expect(call.to).toBe('admin@acme.com');
      expect(call.metadata?.type).toBe('tenant.provisioned');
      expect(call.metadata?.tier).toBe('basic');
    });

    it('does not publish when adminEmail is omitted', async () => {
      setupCreateMocks();

      await service.create({ name: 'Acme', subdomain: 'acme', plan: 'basic' });
      await Promise.resolve();

      expect(mockPublishNotification).not.toHaveBeenCalled();
    });

    it('AMQP failure does not block create response', async () => {
      setupCreateMocks();
      mockPublishNotification.mockImplementation(() => { throw new Error('AMQP down'); });

      // Should not throw even if AMQP fails
      const result = await service.create({
        name: 'Acme', subdomain: 'acme', plan: 'basic', adminEmail: 'admin@acme.com',
      });
      await Promise.resolve();

      expect(result.id).toBe('tid');
    });
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

  describe('offboard', () => {
    it('transitions status: offboarding → plugins disabled → offboarded, subdomain=null', async () => {
      // BEGIN
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // UPDATE tenants SET status='offboarding' RETURNING id, subdomain
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'tid', subdomain: 'acme' }] });
      // UPDATE tenant_plugins SET is_enabled = false
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // UPDATE tenants SET status='offboarded', subdomain=NULL
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // COMMIT
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await service.offboard('tid');

      // Verify offboarding status update (Step 1)
      const offboardingCall = mockQuery.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes("status = 'offboarding'"),
      );
      expect(offboardingCall).toBeDefined();
      expect(offboardingCall![1]).toEqual(['tid']);

      // Verify plugins disabled (Step 2)
      const pluginsDisableCall = mockQuery.mock.calls.find(
        (args) =>
          typeof args[0] === 'string' &&
          args[0].includes('UPDATE tenant_plugins') &&
          args[0].includes('is_enabled = false'),
      );
      expect(pluginsDisableCall).toBeDefined();
      expect(pluginsDisableCall![1]).toEqual(['tid']);

      // Verify offboarded status + subdomain=NULL (Step 3)
      const offboardedCall = mockQuery.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes("status = 'offboarded'"),
      );
      expect(offboardedCall).toBeDefined();
      expect(offboardedCall![0]).toContain('subdomain = NULL');

      // Verify cache invalidation (Step 4)
      expect(mockDelForTenant).toHaveBeenCalledWith('tid', 'tenant-config', 'enabled-plugins');
    });

    it('throws NotFoundException when tenant not found and rolls back', async () => {
      // BEGIN
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // UPDATE tenants SET status='offboarding' — tenant not found
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // ROLLBACK (called inside the if block, explicitly)
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // ROLLBACK (called again in the catch block)
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(service.offboard('bad-id')).rejects.toThrow(NotFoundException);

      // Verify ROLLBACK was issued
      const rollbackCalls = mockQuery.mock.calls.filter(
        (args) => args[0] === 'ROLLBACK',
      );
      expect(rollbackCalls.length).toBeGreaterThanOrEqual(1);

      // Cache should NOT be cleared
      expect(mockDelForTenant).not.toHaveBeenCalled();
    });

    it('rolls back on DB error after BEGIN', async () => {
      // BEGIN
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // UPDATE tenants SET status='offboarding' — DB error
      mockQuery.mockRejectedValueOnce(new Error('DB connection lost'));
      // ROLLBACK (called in catch)
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(service.offboard('tid')).rejects.toThrow('DB connection lost');

      // Verify ROLLBACK was issued from the catch block
      const rollbackCall = mockQuery.mock.calls.find(
        (args) => args[0] === 'ROLLBACK',
      );
      expect(rollbackCall).toBeDefined();

      // Cache should NOT be cleared
      expect(mockDelForTenant).not.toHaveBeenCalled();
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
