import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PoolRegistry } from '../../../../dal/pool/PoolRegistry';
import { CacheManager } from '../../../../dal/cache/CacheManager';
import { BUILT_IN_MANIFESTS } from '../../../../plugins/manifest/built-in-manifests';

const TIER_DEFAULT_PLUGINS: Record<string, string[]> = {
  basic:      ['customer-data'],
  standard:   ['customer-data'],
  premium:    ['customer-data', 'customer-care', 'analytics'],
  enterprise: ['customer-data', 'customer-care', 'analytics', 'marketing'],
  vip:        ['customer-data', 'customer-care', 'analytics', 'marketing', 'automation'],
};

export interface TenantRow {
  id: string; name: string; subdomain: string;
  tier: string; is_active: boolean;
  created_at: string; updated_at: string;
  plugin_count: string;
}

function rowToTenant(row: TenantRow) {
  return {
    id: row.id,
    name: row.name,
    subdomain: row.subdomain,
    plan: row.tier as 'basic' | 'premium' | 'enterprise' | 'vip',
    status: row.is_active ? 'active' as const : 'suspended' as const,
    pluginCount: Number(row.plugin_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class AdminTenantsService {
  constructor(
    private readonly poolRegistry: PoolRegistry,
    private readonly cache: CacheManager,
  ) {}

  async list(params: { page: number; limit: number; search?: string }) {
    const { page, limit, search } = params;
    const offset = (page - 1) * limit;
    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      const countSearchClause = search
        ? `AND (t.name ILIKE '%' || $1 || '%' OR t.subdomain ILIKE '%' || $1 || '%')`
        : '';
      const dataSearchClause = search
        ? `AND (t.name ILIKE '%' || $3 || '%' OR t.subdomain ILIKE '%' || $3 || '%')`
        : '';
      const [countRes, dataRes] = await Promise.all([
        client.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM tenants t WHERE t.subdomain != 'system' ${countSearchClause}`,
          search ? [search] : [],
        ),
        client.query<TenantRow>(
          `SELECT t.id, t.name, t.subdomain, t.tier, t.is_active,
                  t.created_at, t.updated_at,
                  COUNT(tp.id) FILTER (WHERE tp.is_enabled) AS plugin_count
           FROM tenants t
           LEFT JOIN tenant_plugins tp ON tp.tenant_id = t.id
           WHERE t.subdomain != 'system' ${dataSearchClause}
           GROUP BY t.id
           ORDER BY t.created_at DESC
           LIMIT $1 OFFSET $2`,
          search ? [limit, offset, search] : [limit, offset],
        ),
      ]);
      return {
        data: dataRes.rows.map(rowToTenant),
        total: Number(countRes.rows[0].count),
        page,
        limit,
      };
    } finally {
      client.release();
    }
  }

  async findOne(id: string) {
    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      const res = await client.query<TenantRow>(
        `SELECT t.id, t.name, t.subdomain, t.tier, t.is_active,
                t.created_at, t.updated_at,
                COUNT(tp.id) FILTER (WHERE tp.is_enabled) AS plugin_count
         FROM tenants t
         LEFT JOIN tenant_plugins tp ON tp.tenant_id = t.id
         WHERE t.id = $1
         GROUP BY t.id`,
        [id],
      );
      if (!res.rows[0]) throw new NotFoundException(`Tenant not found: ${id}`);
      return rowToTenant(res.rows[0]);
    } finally {
      client.release();
    }
  }

  async create(input: { name: string; subdomain: string; plan: string }) {
    const VALID_PLANS = ['basic', 'standard', 'premium', 'enterprise', 'vip'];
    if (!VALID_PLANS.includes(input.plan)) {
      throw new BadRequestException(`Invalid plan "${input.plan}". Must be one of: ${VALID_PLANS.join(', ')}`);
    }

    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      await client.query('BEGIN');

      const res = await client.query<TenantRow>(
        `INSERT INTO tenants (name, subdomain, tier, config)
         VALUES ($1, $2, $3, '{}')
         RETURNING id, name, subdomain, tier, is_active, created_at, updated_at`,
        [input.name, input.subdomain, input.plan],
      );
      const tenant = res.rows[0];

      // Enable tier-appropriate plugins for every new tenant
      const defaultPlugins = TIER_DEFAULT_PLUGINS[input.plan] ?? ['customer-data'];
      for (const pluginName of defaultPlugins) {
        await client.query(
          `INSERT INTO tenant_plugins (tenant_id, plugin_name, is_enabled)
           VALUES ($1, $2, true)
           ON CONFLICT (tenant_id, plugin_name) DO NOTHING`,
          [tenant.id, pluginName],
        );
      }

      await client.query('COMMIT');
      return rowToTenant({ ...tenant, plugin_count: String(defaultPlugins.length) });
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException(`Subdomain "${input.subdomain}" is already taken`);
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async update(id: string, input: { name?: string; status?: string; plan?: string }) {
    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      await client.query('BEGIN');

      // Fetch current tier BEFORE updating so we can compute the plugin delta
      const currentRes = await client.query<{ tier: string }>(
        'SELECT tier FROM tenants WHERE id = $1',
        [id],
      );
      if (!currentRes.rows[0]) throw new NotFoundException(`Tenant not found: ${id}`);
      const currentTier = currentRes.rows[0].tier;

      const sets: string[] = [];
      const args: unknown[] = [];
      if (input.name)   { args.push(input.name);                sets.push(`name = $${args.length}`); }
      if (input.plan)   { args.push(input.plan);                sets.push(`tier = $${args.length}`); }
      if (input.status) { args.push(input.status === 'active'); sets.push(`is_active = $${args.length}`); }
      if (!sets.length) {
        await client.query('ROLLBACK');
        return this.findOne(id);
      }
      args.push(id);
      const res = await client.query<TenantRow>(
        `UPDATE tenants SET ${sets.join(', ')}, updated_at = NOW()
         WHERE id = $${args.length}
         RETURNING id, name, subdomain, tier, is_active, created_at, updated_at,
                   (SELECT COUNT(*) FROM tenant_plugins tp2 WHERE tp2.tenant_id = tenants.id AND tp2.is_enabled = true)::text AS plugin_count`,
        args,
      );
      if (!res.rows[0]) throw new NotFoundException(`Tenant not found: ${id}`);

      // Handle plugin delta when tier changes
      if (input.plan && input.plan !== currentTier) {
        const newPlugins = TIER_DEFAULT_PLUGINS[input.plan] ?? [];
        const oldPlugins = TIER_DEFAULT_PLUGINS[currentTier] ?? [];
        const toEnable = newPlugins.filter(p => !oldPlugins.includes(p));
        const toDisable = oldPlugins.filter(p => !newPlugins.includes(p));

        if (toEnable.length > 0) {
          await client.query(
            `INSERT INTO tenant_plugins (tenant_id, plugin_name, is_enabled)
             SELECT $1, unnest($2::text[]), true
             ON CONFLICT (tenant_id, plugin_name) DO UPDATE SET is_enabled = true`,
            [id, toEnable],
          );
        }
        if (toDisable.length > 0) {
          await client.query(
            `UPDATE tenant_plugins SET is_enabled = false
             WHERE tenant_id = $1 AND plugin_name = ANY($2::text[])`,
            [id, toDisable],
          );
        }
      }

      await client.query('COMMIT');

      // Invalidate cache after successful commit (outside the DB transaction)
      if (input.plan && input.plan !== currentTier) {
        await this.cache.delForTenant(id, 'tenant-config', 'enabled-plugins');
        await this.cache.delForTenant(id, 'tenant-config', 'tenant-config');
      }

      return rowToTenant(res.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async softDelete(id: string): Promise<void> {
    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      const res = await client.query(
        `UPDATE tenants SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id`,
        [id],
      );
      if (!res.rows[0]) throw new NotFoundException(`Tenant not found: ${id}`);
    } finally {
      client.release();
    }
  }

  async getPlugins(tenantId: string) {
    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      const res = await client.query<{ plugin_name: string; is_enabled: boolean }>(
        `SELECT plugin_name, is_enabled FROM tenant_plugins WHERE tenant_id = $1`,
        [tenantId],
      );
      const enabledMap = new Map(res.rows.map((r) => [r.plugin_name, r.is_enabled]));
      return BUILT_IN_MANIFESTS.map((m) => ({
        id: m.name,
        name: m.name,
        version: m.version,
        enabled: enabledMap.get(m.name) ?? false,
        permissions: m.permissions,
        limits: {
          timeoutMs: m.limits.timeoutMs,
          memoryMb: m.limits.memoryMb,
          maxQueriesPerRequest: m.limits.maxQueries,
        },
      }));
    } finally {
      client.release();
    }
  }

  async togglePlugin(tenantId: string, pluginId: string, enabled: boolean) {
    const manifest = BUILT_IN_MANIFESTS.find((m) => m.name === pluginId);
    if (!manifest) throw new NotFoundException(`Unknown plugin: ${pluginId}`);

    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      // Load current enabled state for all plugins of this tenant
      const { rows } = await client.query<{ plugin_name: string; is_enabled: boolean }>(
        `SELECT plugin_name, is_enabled FROM tenant_plugins WHERE tenant_id = $1`,
        [tenantId],
      );
      const enabledSet = new Set(rows.filter((r) => r.is_enabled).map((r) => r.plugin_name));

      if (enabled) {
        // ENABLE: all dependencies must already be enabled
        const missing = manifest.dependencies.filter((dep) => !enabledSet.has(dep));
        if (missing.length > 0) {
          throw new BadRequestException(
            `Cannot enable "${pluginId}": required dependencies are disabled: ${missing.join(', ')}`,
          );
        }
        await client.query(
          `INSERT INTO tenant_plugins (tenant_id, plugin_name, is_enabled)
           VALUES ($1, $2, true)
           ON CONFLICT (tenant_id, plugin_name) DO UPDATE SET is_enabled = true`,
          [tenantId, pluginId],
        );
      } else {
        // DISABLE: cascade disable all dependents (plugins that depend on this one)
        const toCascade = BUILT_IN_MANIFESTS
          .filter((m) => m.dependencies.includes(pluginId) && enabledSet.has(m.name))
          .map((m) => m.name);

        const toDisable = [pluginId, ...toCascade];
        await client.query(
          `INSERT INTO tenant_plugins (tenant_id, plugin_name, is_enabled)
           SELECT $1, unnest($2::text[]), false
           ON CONFLICT (tenant_id, plugin_name) DO UPDATE SET is_enabled = false`,
          [tenantId, toDisable],
        );

        await this.cache.delForTenant(tenantId, 'tenant-config', 'enabled-plugins');
        return { pluginId, enabled, cascadeDisabled: toCascade };
      }

      await this.cache.delForTenant(tenantId, 'tenant-config', 'enabled-plugins');
      return { pluginId, enabled };
    } finally {
      client.release();
    }
  }
}
