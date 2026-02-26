// ============================================================
// PluginRegistryService — register/lookup plugin cores
//
// Two responsibilities:
//  1. Core registry: in-memory Map<name, IPluginCore>
//     Each plugin module registers itself via OnModuleInit.
//
//  2. Enabled plugin lookup: cache-first read from tenant_plugins
//     table. Cache TTL 5 min. Uses metadata pool (bypasses RLS).
// ============================================================
import { Injectable, NotFoundException } from '@nestjs/common';
import type { IPluginCore } from '../interfaces/plugin-core.interface';
import type { ICacheManager } from '../../dal/interfaces/ICacheManager';
import { PoolRegistry } from '../../dal/pool/PoolRegistry';

@Injectable()
export class PluginRegistryService {
  private readonly cores = new Map<string, IPluginCore>();

  register(core: IPluginCore): void {
    this.cores.set(core.manifest.name, core);
  }

  getCoreOrThrow(name: string): IPluginCore {
    const core = this.cores.get(name);
    if (!core) {
      throw new NotFoundException(`Plugin core not registered: "${name}"`);
    }
    return core;
  }

  isRegistered(name: string): boolean {
    return this.cores.has(name);
  }

  /**
   * Returns enabled plugin names for a tenant.
   * Cache-first (5 min TTL) to avoid DB hit on every request.
   * Falls back to metadata pool query when cache misses.
   *
   * Must be called inside TenantContext.run() so CacheManager
   * can build the scoped key t:<tenantId>:tenant-config:enabled-plugins.
   */
  async getEnabledPlugins(
    tenantId: string,
    cache: ICacheManager,
    pool: PoolRegistry,
  ): Promise<string[]> {
    const cached = await cache.get<string[]>('tenant-config', 'enabled-plugins');
    if (cached) return cached;

    const client = await pool.acquireMetadataConnection();
    try {
      const { rows } = await client.query<{ plugin_name: string }>(
        'SELECT plugin_name FROM tenant_plugins WHERE tenant_id=$1 AND is_enabled=true',
        [tenantId],
      );
      const plugins = rows.map((r) => r.plugin_name);
      await cache.set('tenant-config', 'enabled-plugins', plugins, 300);
      return plugins;
    } finally {
      client.release();
    }
  }
}
