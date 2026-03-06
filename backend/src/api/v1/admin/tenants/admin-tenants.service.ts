import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolRegistry } from '../../../../dal/pool/PoolRegistry';
import { BUILT_IN_MANIFESTS } from '../../../../plugins/manifest/built-in-manifests';

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
    plan: row.tier as 'standard' | 'vip' | 'enterprise',
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
    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      const res = await client.query<TenantRow>(
        `INSERT INTO tenants (name, subdomain, tier, config)
         VALUES ($1, $2, $3, '{}')
         RETURNING id, name, subdomain, tier, is_active, created_at, updated_at`,
        [input.name, input.subdomain, input.plan],
      );
      return rowToTenant({ ...res.rows[0], plugin_count: '0' });
    } finally {
      client.release();
    }
  }

  async update(id: string, input: { name?: string; status?: string; plan?: string }) {
    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      const sets: string[] = [];
      const args: unknown[] = [];
      if (input.name)   { args.push(input.name);                sets.push(`name = $${args.length}`); }
      if (input.plan)   { args.push(input.plan);                sets.push(`tier = $${args.length}`); }
      if (input.status) { args.push(input.status === 'active'); sets.push(`is_active = $${args.length}`); }
      if (!sets.length) return this.findOne(id);
      args.push(id);
      const res = await client.query<TenantRow>(
        `UPDATE tenants SET ${sets.join(', ')}, updated_at = NOW()
         WHERE id = $${args.length}
         RETURNING id, name, subdomain, tier, is_active, created_at, updated_at,
                   (SELECT COUNT(*) FROM tenant_plugins tp2 WHERE tp2.tenant_id = tenants.id AND tp2.is_enabled = true)::text AS plugin_count`,
        args,
      );
      if (!res.rows[0]) throw new NotFoundException(`Tenant not found: ${id}`);
      return rowToTenant(res.rows[0]);
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
    const known = BUILT_IN_MANIFESTS.find((m) => m.name === pluginId);
    if (!known) throw new NotFoundException(`Unknown plugin: ${pluginId}`);
    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      await client.query(
        `INSERT INTO tenant_plugins (tenant_id, plugin_name, is_enabled)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, plugin_name)
         DO UPDATE SET is_enabled = $3`,
        [tenantId, pluginId, enabled],
      );
      return { pluginId, enabled };
    } finally {
      client.release();
    }
  }
}
