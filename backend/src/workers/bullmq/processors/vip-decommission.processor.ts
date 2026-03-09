import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import Knex from 'knex';
import { QUEUE_VIP_DECOMMISSION } from '../queue.constants';
import { PoolRegistry } from '../../../dal/pool/PoolRegistry';
import { TenantQuotaEnforcer } from '../../../dal/pool/TenantQuotaEnforcer';

const PLUGIN_TABLES = ['customers', 'support_cases', 'automation_triggers', 'marketing_campaigns'];
const BATCH_SIZE = 500;

export interface VipDecommissionJobData {
  tenantId: string;
  slug: string;
  newTier: string;
}

@Processor(QUEUE_VIP_DECOMMISSION, { concurrency: 1 })
export class VipDecommissionProcessor extends WorkerHost {
  private readonly logger = new Logger(VipDecommissionProcessor.name);

  constructor(private readonly poolRegistry: PoolRegistry) {
    super();
  }

  async process(job: Job<VipDecommissionJobData>): Promise<void> {
    const { tenantId, slug, newTier } = job.data;
    const dbName = `crm_vip_${slug}`;
    const { config } = await import('../../../config/env');
    const sharedUrl = config.DATABASE_URL;
    const dedicatedUrl = sharedUrl.replace(/\/[^/?]+(\?.*)?$/, `/${dbName}$1`);

    this.logger.log(`[VipDecommission] Starting for tenant ${tenantId} → ${newTier}`);

    const destClient = await this.poolRegistry.acquireMetadataConnection();
    try {
      // Step 1: Copy data from dedicated → shared DB
      const srcKnex = Knex({ client: 'postgresql', connection: dedicatedUrl });
      try {
        for (const table of PLUGIN_TABLES) {
          await this.copyTable(table, tenantId, srcKnex, destClient as any);
        }
      } finally {
        await srcKnex.destroy();
      }

      // Step 2: Verify row counts
      const vipKnex = Knex({ client: 'postgresql', connection: dedicatedUrl });
      try {
        for (const table of PLUGIN_TABLES) {
          const srcCount = await vipKnex(table)
            .where({ tenant_id: tenantId })
            .count('* as count')
            .then(r => Number((r[0] as any).count));
          const { rows } = await (destClient as any).query(
            `SELECT COUNT(*) AS count FROM "${table}" WHERE tenant_id = $1`,
            [tenantId],
          );
          const destCount = Number(rows[0]?.count ?? 0);
          if (srcCount !== destCount) {
            throw new Error(`Mismatch for ${table}: vip=${srcCount} shared=${destCount}`);
          }
        }
      } finally {
        await vipKnex.destroy();
      }

      // Step 3: Update tenant — clear db_url, set new tier, mark active
      await destClient.query(
        `UPDATE tenants SET db_url = NULL, tier = $1, status = 'active', updated_at = NOW() WHERE id = $2`,
        [newTier, tenantId],
      );

      // Step 4: Deregister VIP pool
      await this.poolRegistry.deregisterVipPool(tenantId);

      // Step 5: Register quota enforcer for new tier
      TenantQuotaEnforcer.register(tenantId, newTier);

      // Step 6: Mark vip_db_registry as decommissioned
      await destClient.query(
        `UPDATE vip_db_registry SET decommissioned_at = NOW() WHERE tenant_id = $1 AND decommissioned_at IS NULL`,
        [tenantId],
      );

      // Step 7: DROP DATABASE (irreversible — after all above succeed)
      await destClient.query(`DROP DATABASE IF EXISTS "${dbName}"`);

      this.logger.log(`[VipDecommission] Completed for tenant ${tenantId}`);
    } finally {
      destClient.release();
    }
  }

  private async copyTable(
    table: string,
    tenantId: string,
    srcKnex: Knex.Knex,
    destClient: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  ): Promise<void> {
    let offset = 0;
    for (;;) {
      const rows = await srcKnex(table)
        .where({ tenant_id: tenantId })
        .limit(BATCH_SIZE)
        .offset(offset);
      if (rows.length === 0) break;
      for (const row of rows) {
        const cols = Object.keys(row);
        const vals = cols.map((_, i) => `$${i + 1}`).join(', ');
        await destClient.query(
          `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${vals}) ON CONFLICT DO NOTHING`,
          Object.values(row),
        );
      }
      offset += rows.length;
      if (rows.length < BATCH_SIZE) break;
    }
    this.logger.debug(`[VipDecommission] Copied ${offset} rows from ${table}`);
  }
}
