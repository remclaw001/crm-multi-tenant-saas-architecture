import { Injectable, NotFoundException, BadRequestException, ConflictException, Inject, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Redis } from 'ioredis';
import type { Queue } from 'bullmq';
import { PoolRegistry } from '../../../../dal/pool/PoolRegistry';
import { CacheManager } from '../../../../dal/cache/CacheManager';
import { TenantQuotaEnforcer } from '../../../../dal/pool/TenantQuotaEnforcer';
import { BUILT_IN_MANIFESTS } from '../../../../plugins/manifest/built-in-manifests';
import { AmqpPublisher } from '../../../../workers/amqp/amqp-publisher.service';
import { QUEUE_VIP_MIGRATION, QUEUE_VIP_DECOMMISSION, QUEUE_DATA_EXPORT, QUEUE_PLUGIN_INIT } from '../../../../workers/bullmq/queue.constants';
import { CONFIG_RELOAD_CHANNEL, CACHE_INVALIDATE_CHANNEL } from '../../../../dal/pubsub/tenant-config-reload.service';
import type { VipMigrationJobData } from '../../../../workers/bullmq/processors/vip-migration.processor';
import type { VipDecommissionJobData } from '../../../../workers/bullmq/processors/vip-decommission.processor';
import type { DataExportJobData } from '../../../../workers/bullmq/processors/data-export.processor';
import type { PluginInitJobData } from '../../../../plugins/init/plugin-init.processor';
import { PluginDependencyService } from '../../../../plugins/deps/plugin-dependency.service';
import { PluginDependencyError } from '../../../../plugins/deps/plugin-dependency.error';

const TIER_DEFAULT_PLUGINS: Record<string, string[]> = {
  basic:      ['customer-data'],
  premium:    ['customer-data', 'customer-care', 'analytics'],
  enterprise: ['customer-data', 'customer-care', 'analytics', 'marketing'],
  vip:        ['customer-data', 'customer-care', 'analytics', 'marketing', 'automation'],
};

/** Numeric rank — higher number = higher tier. */
const TIER_ORDER: Record<string, number> = {
  basic: 0, premium: 1, enterprise: 2, vip: 3,
};

/** Readable connection cap per tier (mirrors TenantQuotaEnforcer constants). */
const TIER_CONN_CAPS: Record<string, string> = {
  basic: '10', premium: '20', enterprise: '30', vip: 'unlimited',
};

/** Readable API rate limit per tier (spec §05). */
const TIER_RATE_LIMITS: Record<string, string> = {
  basic: '100 rpm', premium: '500 rpm', enterprise: '2000 rpm', vip: 'unlimited',
};

export type TenantStatus = 'provisioning' | 'active' | 'migrating' | 'grace_period' | 'suspended' | 'offboarding' | 'offboarded';

/** Shape returned by previewDowngrade(). */
export interface DowngradePreview {
  currentPlan:        string;
  newPlan:            string;
  pluginsToDisable:   string[];
  dataNote:           string;
  connectionCapChange: string;
  rateLimit:          string;
}

export interface TenantRow {
  id: string; name: string; subdomain: string | null;
  tier: string; is_active: boolean; status?: string;
  created_at: string; updated_at: string;
  plugin_count: string;
}

function rowToTenant(row: TenantRow) {
  return {
    id: row.id,
    name: row.name,
    subdomain: row.subdomain,
    plan: row.tier as 'basic' | 'premium' | 'enterprise' | 'vip',
    status: row.status as TenantStatus ?? (row.is_active ? 'active' : 'suspended'),
    pluginCount: Number(row.plugin_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class AdminTenantsService {
  private readonly logger = new Logger(AdminTenantsService.name);

  constructor(
    private readonly poolRegistry: PoolRegistry,
    private readonly cache: CacheManager,
    private readonly amqp: AmqpPublisher,
    @Inject('REDIS_CLIENT')              private readonly redis: Redis,
    @InjectQueue(QUEUE_VIP_MIGRATION)    private readonly vipMigrationQueue: Queue,
    @InjectQueue(QUEUE_VIP_DECOMMISSION) private readonly vipDecommissionQueue: Queue,
    @InjectQueue(QUEUE_DATA_EXPORT)      private readonly dataExportQueue: Queue,
    private readonly deps: PluginDependencyService,
    @InjectQueue(QUEUE_PLUGIN_INIT)      private readonly pluginInitQueue: Queue,
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
          `SELECT t.id, t.name, t.subdomain, t.tier, t.is_active, t.status,
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
        `SELECT t.id, t.name, t.subdomain, t.tier, t.is_active, t.status,
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

  async create(input: { name: string; subdomain: string; plan: string; adminEmail?: string }) {
    const VALID_PLANS = ['basic', 'premium', 'enterprise', 'vip'];
    if (!VALID_PLANS.includes(input.plan)) {
      throw new BadRequestException(`Invalid plan "${input.plan}". Must be one of: ${VALID_PLANS.join(', ')}`);
    }

    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      await client.query('BEGIN');

      const res = await client.query<TenantRow>(
        `INSERT INTO tenants (name, subdomain, tier, status, config)
         VALUES ($1, $2, $3, 'provisioning', '{}')
         RETURNING id, name, subdomain, tier, is_active, status, created_at, updated_at`,
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

      // Record admin contact for billing notifications and offboard emails
      if (input.adminEmail) {
        await client.query(
          `INSERT INTO tenant_admins (tenant_id, email, role) VALUES ($1, $2, 'admin')`,
          [tenant.id, input.adminEmail],
        );
      }

      // Activate tenant after plugins are ready
      await client.query(
        `UPDATE tenants SET status = 'active', updated_at = NOW() WHERE id = $1`,
        [tenant.id],
      );

      await client.query('COMMIT');

      // Register per-tenant connection cap.
      // VIP tenants are exempt: they get a dedicated DB with their own pool;
      // the VipMigrationProcessor will deregister any cap once migration completes.
      if (input.plan !== 'vip') {
        TenantQuotaEnforcer.register(tenant.id, input.plan);
      }

      // Warm tenant-lookup cache immediately after create
      await this.cache.setTenantLookup({
        id: tenant.id,
        name: tenant.name ?? input.name,
        subdomain: tenant.subdomain ?? input.subdomain,
        tier: (input.plan as any),
        status: 'active' as any,
        dbUrl: null,
        isActive: true,
        allowedOrigins: [],
      });

      const result = rowToTenant({
        ...tenant,
        status: 'active',
        plugin_count: String(defaultPlugins.length),
      });

      // Fire-and-forget welcome email event (don't block response)
      if (input.adminEmail) {
        const loginUrl = `https://${tenant.subdomain}.crm.app/login`;
        Promise.resolve().then(() =>
          this.amqp.publishNotification({
            tenantId: tenant.id,
            userId: 'system',
            channel: 'email',
            to: input.adminEmail!,
            subject: `Welcome to the platform — ${tenant.name}`,
            body: `Your tenant "${tenant.name}" has been provisioned on the ${input.plan} plan.\n\nLogin: ${loginUrl}`,
            metadata: {
              type: 'tenant.provisioned',
              tenantId: tenant.id,
              tier: input.plan,
              subdomain: tenant.subdomain,
              name: tenant.name,
              loginUrl,
            },
          })
        ).catch((err) => {
          console.error('[AdminTenantsService] Failed to publish welcome email event', err);
        });
      }

      return result;
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

  async update(id: string, input: { name?: string; status?: TenantStatus; plan?: string }) {
    const VALID_PLANS = ['basic', 'premium', 'enterprise', 'vip'];
    if (input.plan && !VALID_PLANS.includes(input.plan)) {
      throw new BadRequestException(`Invalid plan: ${input.plan}`);
    }

    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      await client.query('BEGIN');

      // Fetch current tier BEFORE updating so we can:
      //   1. compute the plugin delta
      //   2. detect VIP upgrade/downgrade for status gate
      const currentRes = await client.query<{ tier: string }>(
        'SELECT tier FROM tenants WHERE id = $1',
        [id],
      );
      if (!currentRes.rows[0]) throw new NotFoundException(`Tenant not found: ${id}`);
      const currentTier = currentRes.rows[0].tier;

      // Detect VIP transitions early — needed to build the correct SET clause
      const isVipUpgrade   = !!input.plan && input.plan === 'vip' && currentTier !== 'vip';
      const isVipDowngrade = !!input.plan && input.plan !== 'vip' && currentTier === 'vip';

      const sets: string[] = [];
      const args: unknown[] = [];
      if (input.name) { args.push(input.name); sets.push(`name = $${args.length}`); }
      if (input.plan) { args.push(input.plan); sets.push(`tier = $${args.length}`); }

      if (isVipUpgrade || isVipDowngrade) {
        // Gate the tenant as read-only while migration runs (spec §02 / §03).
        // VipMigrationProcessor / VipDecommissionProcessor sets status back to 'active' on completion.
        args.push('migrating'); sets.push(`status = $${args.length}`);
        args.push(false);       sets.push(`is_active = $${args.length}`);
      } else if (input.status) {
        args.push(input.status);
        sets.push(`status = $${args.length}`);
        // Keep is_active in sync with status
        args.push(input.status === 'active');
        sets.push(`is_active = $${args.length}`);
      }

      if (!sets.length) {
        await client.query('ROLLBACK');
        return this.findOne(id);
      }

      args.push(id);
      const res = await client.query<TenantRow>(
        `UPDATE tenants SET ${sets.join(', ')}, updated_at = NOW()
         WHERE id = $${args.length}
         RETURNING id, name, subdomain, tier, is_active, status, created_at, updated_at,
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

      // ── Post-commit side effects (tier change only) ────────
      if (input.plan && input.plan !== currentTier) {
        const subdomain = res.rows[0]?.subdomain ?? null;

        // Invalidate this instance's Redis cache keys
        await this.cache.delForTenant(id, 'tenant-config', 'enabled-plugins');
        await this.cache.delForTenant(id, 'tenant-config', 'tenant-config');
        await this.cache.invalidateTenantLookup(id, subdomain);

        // Update this instance's in-memory quota cap.
        // VIP upgrades/downgrades are exempt — the respective processor handles
        // deregister/register after migration completes.
        if (!isVipUpgrade && !isVipDowngrade) {
          TenantQuotaEnforcer.updateCap(id, input.plan);
        }

        // Broadcast to ALL other app instances so they also update their in-memory state
        // (TenantQuotaEnforcer cap + any other per-instance caches).
        await this.redis.publish(
          CONFIG_RELOAD_CHANNEL,
          JSON.stringify({ tenantId: id, newTier: input.plan }),
        );
        await this.redis.publish(
          CACHE_INVALIDATE_CHANNEL,
          JSON.stringify({ tenantId: id, scope: 'tenant-context' }),
        );

        if (isVipUpgrade) {
          await this.vipMigrationQueue.add('migrate', {
            tenantId: id,
            slug: subdomain ?? id,
            currentTier,
          } satisfies VipMigrationJobData);
        }

        if (isVipDowngrade) {
          await this.vipDecommissionQueue.add('decommission', {
            tenantId: id,
            slug: subdomain ?? id,
            newTier: input.plan,
          } satisfies VipDecommissionJobData);
        }
      }

      return rowToTenant(res.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async offboard(id: string): Promise<void> {
    const client = await this.poolRegistry.acquireMetadataConnection();
    let subdomain: string | null = null;
    try {
      await client.query('BEGIN');

      // Step 1: lock → offboarding
      const lockRes = await client.query<{ id: string; name: string; subdomain: string | null; tier: string }>(
        `UPDATE tenants
         SET status = 'offboarding', is_active = false, updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, subdomain, tier`,
        [id],
      );
      if (!lockRes.rows[0]) {
        await client.query('ROLLBACK');
        throw new NotFoundException(`Tenant not found: ${id}`);
      }
      subdomain = lockRes.rows[0].subdomain;
      const tier = lockRes.rows[0].tier;
      const tenantName = lockRes.rows[0].name;

      // Fetch admin contact for export notification email
      const adminRes = await client.query<{ email: string }>(
        `SELECT email FROM tenant_admins WHERE tenant_id = $1 LIMIT 1`,
        [id],
      );
      const adminEmail = adminRes.rows[0]?.email;

      // Step 2: disable all plugins
      await client.query(
        `UPDATE tenant_plugins SET is_enabled = false WHERE tenant_id = $1`,
        [id],
      );

      // Step 3: offboarded + release subdomain + timestamp
      await client.query(
        `UPDATE tenants
         SET status = 'offboarded', subdomain = NULL,
             offboarded_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [id],
      );

      await client.query('COMMIT');

      // ── Post-transaction side effects ─────────────────────────
      // 4. Release per-tenant quota slot
      TenantQuotaEnforcer.deregister(id);

      // 5. Full Redis flush
      await this.cache.flushTenant(id);
      await this.cache.invalidateTenantLookup(id, subdomain);

      // 6. Publish audit trail
      await this.amqp.publishAudit({
        tenantId: id,
        userId: 'system',
        action: 'tenant.offboarded',
        resourceType: 'tenant',
        resourceId: id,
        payload: { subdomain, tier },
        timestamp: new Date().toISOString(),
      });

      // 7. Enqueue S3 data export job
      await this.dataExportQueue.add('export', {
        tenantId: id,
        tenantName,
        tier,
        adminEmail,
      } satisfies DataExportJobData);

      // 8. If VIP: deregister dedicated pool
      if (tier === 'vip') {
        await this.poolRegistry.deregisterVipPool(id);
      }

    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
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

  async togglePlugin(
    tenantId: string,
    pluginId: string,
    enabled: boolean,
    userId: string,
  ): Promise<{ pluginId: string; enabled: boolean; initializing?: boolean }> {
    const manifest = BUILT_IN_MANIFESTS.find((m) => m.name === pluginId);
    if (!manifest) throw new NotFoundException(`Unknown plugin: ${pluginId}`);

    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      const { rows } = await client.query<{
        plugin_name: string;
        is_enabled: boolean;
        initialized_at: string | null;
      }>(
        `SELECT plugin_name, is_enabled, initialized_at FROM tenant_plugins WHERE tenant_id = $1`,
        [tenantId],
      );
      const enabledPlugins = rows.filter((r) => r.is_enabled).map((r) => r.plugin_name);

      if (enabled) {
        const missing = this.deps.getMissingDeps(pluginId, enabledPlugins);
        if (missing.length > 0) {
          throw new PluginDependencyError(pluginId, 'enable', missing, []);
        }
        await client.query(
          `INSERT INTO tenant_plugins (tenant_id, plugin_name, is_enabled)
           VALUES ($1, $2, true)
           ON CONFLICT (tenant_id, plugin_name) DO UPDATE SET is_enabled = true`,
          [tenantId, pluginId],
        );
        const targetRow = rows.find((r) => r.plugin_name === pluginId);
        const isFirstEnable = !targetRow?.initialized_at;
        if (isFirstEnable) {
          await this.pluginInitQueue.add('init', { tenantId, pluginId } satisfies PluginInitJobData);
        }
        try {
          await this.amqp.publishAudit({
            tenantId,
            userId,
            action: 'plugin.enabled',
            resourceType: 'plugin',
            resourceId: pluginId,
            payload: { pluginId, initializing: isFirstEnable },
            timestamp: new Date().toISOString(),
          });
        } catch (auditErr) {
          this.logger.warn(`[togglePlugin] audit publish failed for plugin.enabled (tenant=${tenantId}, plugin=${pluginId}): ${(auditErr as Error).message}`);
        }
        await this.cache.delForTenant(tenantId, 'tenant-config', 'enabled-plugins');
        return { pluginId, enabled: true, initializing: isFirstEnable };
      } else {
        const blocking = this.deps.getBlockingDependents(pluginId, enabledPlugins);
        if (blocking.length > 0) {
          throw new PluginDependencyError(pluginId, 'disable', [], blocking);
        }
        await client.query(
          `INSERT INTO tenant_plugins (tenant_id, plugin_name, is_enabled)
           VALUES ($1, $2, false)
           ON CONFLICT (tenant_id, plugin_name) DO UPDATE SET is_enabled = false`,
          [tenantId, pluginId],
        );
        try {
          await this.amqp.publishAudit({
            tenantId,
            userId,
            action: 'plugin.disabled',
            resourceType: 'plugin',
            resourceId: pluginId,
            payload: { pluginId },
            timestamp: new Date().toISOString(),
          });
        } catch (auditErr) {
          this.logger.warn(`[togglePlugin] audit publish failed for plugin.disabled (tenant=${tenantId}, plugin=${pluginId}): ${(auditErr as Error).message}`);
        }
        await this.cache.delForTenant(tenantId, 'tenant-config', 'enabled-plugins');
        return { pluginId, enabled: false };
      }
    } finally {
      client.release();
    }
  }

  /**
   * Returns a read-only impact summary for a proposed shared-tier downgrade.
   * No side effects — call this before confirmDowngrade() to show the admin
   * what will change before they commit.
   *
   * Throws BadRequestException if newPlan is not a valid downgrade
   * (same tier, upgrade, or VIP — VIP uses the vip-decommission flow).
   */
  async previewDowngrade(id: string, newPlan: string): Promise<DowngradePreview> {
    if (newPlan === 'vip' || !(newPlan in TIER_ORDER)) {
      throw new BadRequestException(`Invalid downgrade target: "${newPlan}"`);
    }

    const tenant = await this.findOne(id);
    const currentPlan = tenant.plan;

    if (currentPlan === 'vip') {
      throw new BadRequestException(
        'VIP downgrades require the VIP decommission flow (PATCH with plan change)',
      );
    }

    if ((TIER_ORDER[newPlan] ?? -1) >= (TIER_ORDER[currentPlan] ?? 0)) {
      throw new BadRequestException(
        `"${newPlan}" is not a downgrade from "${currentPlan}"`,
      );
    }

    const pluginsToDisable = (TIER_DEFAULT_PLUGINS[currentPlan] ?? [])
      .filter(p => !(TIER_DEFAULT_PLUGINS[newPlan] ?? []).includes(p));

    return {
      currentPlan,
      newPlan,
      pluginsToDisable,
      dataNote: pluginsToDisable.length > 0
        ? 'Plugin data remains in the database but will not be accessible until the plan is upgraded again.'
        : 'No plugin changes required.',
      connectionCapChange: `${TIER_CONN_CAPS[currentPlan]} → ${TIER_CONN_CAPS[newPlan]} connections`,
      rateLimit: `${TIER_RATE_LIMITS[currentPlan]} → ${TIER_RATE_LIMITS[newPlan]}`,
    };
  }

  /**
   * Applies a shared-tier downgrade after the admin has reviewed the preview.
   * Delegates to update() which handles plugin delta, cache invalidation,
   * quota cap update, and Redis pub/sub broadcast.
   *
   * Throws BadRequestException for same-tier, upgrade, or VIP attempts.
   */
  async confirmDowngrade(id: string, newPlan: string): Promise<ReturnType<typeof rowToTenant>> {
    if (newPlan === 'vip' || !(newPlan in TIER_ORDER)) {
      throw new BadRequestException(`Invalid downgrade target: "${newPlan}"`);
    }

    const tenant = await this.findOne(id);
    const currentPlan = tenant.plan;

    if (currentPlan === 'vip') {
      throw new BadRequestException(
        'VIP downgrades require the VIP decommission flow (PATCH with plan change)',
      );
    }

    if ((TIER_ORDER[newPlan] ?? -1) >= (TIER_ORDER[currentPlan] ?? 0)) {
      throw new BadRequestException(
        `"${newPlan}" is not a downgrade from "${currentPlan}"`,
      );
    }

    return this.update(id, { plan: newPlan });
  }
}
