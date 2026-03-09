import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import Knex from 'knex';
import { QUEUE_VIP_MIGRATION, QUEUE_VIP_SHARED_CLEANUP } from '../queue.constants';
import { PoolRegistry } from '../../../dal/pool/PoolRegistry';
import { TenantQuotaEnforcer } from '../../../dal/pool/TenantQuotaEnforcer';
import type { VipSharedCleanupJobData } from './vip-shared-cleanup.processor';

/** 24-hour safety window before shared-DB rows are permanently removed. */
const CLEANUP_DELAY_MS = 24 * 60 * 60 * 1_000;

const VIP_DB_PREFIX = 'crm_vip_';
const BATCH_SIZE = 500;

const PLUGIN_TABLES = [
  'customers',
  'support_cases',
  'automation_triggers',
  'marketing_campaigns',
];

export interface VipMigrationJobData {
  tenantId: string;
  slug: string;
  currentTier: string; // rollback target on failure
}

@Processor(QUEUE_VIP_MIGRATION, { concurrency: 1 })
export class VipMigrationProcessor extends WorkerHost {
  private readonly logger = new Logger(VipMigrationProcessor.name);

  constructor(
    private readonly poolRegistry: PoolRegistry,
    @InjectQueue(QUEUE_VIP_SHARED_CLEANUP)
    private readonly cleanupQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<VipMigrationJobData>): Promise<void> {
    const { tenantId, slug, currentTier } = job.data;
    const dbName = `${VIP_DB_PREFIX}${slug}`;
    const { config } = await import('../../../config/env');
    const sharedUrl = config.DATABASE_URL;
    const dedicatedUrl = sharedUrl.replace(/\/[^/?]+(\?.*)?$/, `/${dbName}$1`);

    this.logger.log(`[VipMigration] Starting for tenant ${tenantId} (${slug})`);
    let dbCreated = false;

    const metaClient = await this.poolRegistry.acquireMetadataConnection();
    try {
      // Step 0: Re-gate the tenant as migrating.
      // admin-tenants.service.update() already sets status='migrating' before enqueueing,
      // but on BullMQ retries the rollback handler resets it to 'active'.
      // This idempotent UPDATE ensures the gateway always blocks writes during migration.
      await metaClient.query(
        `UPDATE tenants SET status = 'migrating', updated_at = NOW()
         WHERE id = $1 AND status != 'migrating'`,
        [tenantId],
      );

      // Step 1: CREATE DATABASE
      await metaClient.query(`CREATE DATABASE "${dbName}"`);
      dbCreated = true;
      this.logger.log(`[VipMigration] Created database ${dbName}`);

      // Step 2: Create schema on dedicated DB
      const vipKnex = Knex({ client: 'postgresql', connection: dedicatedUrl });
      try {
        await this.createPluginSchema(vipKnex);
        this.logger.log(`[VipMigration] Schema created on ${dbName}`);

        // Step 3: Copy data from shared DB
        const sharedClient = await this.poolRegistry.acquireMetadataConnection();
        try {
          for (const table of PLUGIN_TABLES) {
            await this.copyTable(table, tenantId, sharedClient as any, vipKnex);
          }
        } finally {
          sharedClient.release();
        }

        // Step 4: Verify row counts
        const countClient = await this.poolRegistry.acquireMetadataConnection();
        try {
          await this.verifyRowCounts(PLUGIN_TABLES, tenantId, countClient as any, vipKnex);
        } finally {
          countClient.release();
        }

        this.logger.log(`[VipMigration] Data verified for tenant ${tenantId}`);
      } finally {
        await vipKnex.destroy();
      }

      // Step 5: Register VIP pool in PoolRegistry
      this.poolRegistry.registerVipPool(tenantId, dedicatedUrl);

      // Step 6: Write to vip_db_registry + update tenant status
      await metaClient.query('BEGIN');
      await metaClient.query(
        `INSERT INTO vip_db_registry (tenant_id, db_name, db_url, migrated_at)
         VALUES ($1, $2, $3, NOW())`,
        [tenantId, dbName, dedicatedUrl],
      );
      await metaClient.query(
        `UPDATE tenants SET db_url = $1, status = 'active', updated_at = NOW() WHERE id = $2`,
        [dedicatedUrl, tenantId],
      );
      await metaClient.query('COMMIT');

      // Step 7: VIP tenants are exempt from per-tenant connection caps
      TenantQuotaEnforcer.deregister(tenantId);

      // Step 8: Schedule shared-DB row deletion 24h from now.
      // The window lets the ops team verify the dedicated DB is healthy
      // before shared rows are permanently removed (spec §02 Step 5).
      await this.cleanupQueue.add(
        'cleanup-shared-db',
        { tenantId, slug } satisfies VipSharedCleanupJobData,
        { delay: CLEANUP_DELAY_MS },
      );

      this.logger.log(`[VipMigration] Completed for tenant ${tenantId}`);
    } catch (err) {
      this.logger.error(`[VipMigration] Failed for tenant ${tenantId}:`, err);

      // Rollback: restore original tier/status
      try {
        await metaClient.query(
          `UPDATE tenants SET status = 'active', tier = $1, updated_at = NOW() WHERE id = $2`,
          [currentTier, tenantId],
        );
        TenantQuotaEnforcer.register(tenantId, currentTier);
      } catch (rollbackErr) {
        this.logger.error('[VipMigration] Rollback failed:', rollbackErr);
      }

      // Drop the dedicated DB if it was created
      if (dbCreated) {
        try {
          await metaClient.query(`DROP DATABASE IF EXISTS "${dbName}"`);
        } catch (dropErr) {
          this.logger.error(`[VipMigration] Failed to drop ${dbName}:`, dropErr);
        }
      }

      throw err;
    } finally {
      metaClient.release();
    }
  }

  private async createPluginSchema(knex: Knex.Knex): Promise<void> {
    await knex.schema.createTableIfNotExists('customers', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.string('name').notNullable();
      t.string('email');
      t.string('phone');
      t.jsonb('metadata').defaultTo('{}');
      t.timestamps(true, true);
    });
    await knex.schema.createTableIfNotExists('support_cases', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.uuid('customer_id');
      t.string('title').notNullable();
      t.text('description');
      t.string('status').defaultTo('open');
      t.timestamps(true, true);
    });
    await knex.schema.createTableIfNotExists('automation_triggers', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.string('name').notNullable();
      t.jsonb('config').defaultTo('{}');
      t.boolean('is_active').defaultTo(true);
      t.timestamps(true, true);
    });
    await knex.schema.createTableIfNotExists('marketing_campaigns', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.string('name').notNullable();
      t.string('status').defaultTo('draft');
      t.jsonb('config').defaultTo('{}');
      t.timestamps(true, true);
    });
  }

  private async copyTable(
    table: string,
    tenantId: string,
    sourceClient: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
    destKnex: Knex.Knex,
  ): Promise<void> {
    let offset = 0;
    for (;;) {
      const { rows } = await sourceClient.query(
        `SELECT * FROM "${table}" WHERE tenant_id = $1 ORDER BY created_at LIMIT $2 OFFSET $3`,
        [tenantId, BATCH_SIZE, offset],
      );
      if (rows.length === 0) break;
      await destKnex(table).insert(rows);
      offset += rows.length;
      if (rows.length < BATCH_SIZE) break;
    }
    this.logger.debug(`[VipMigration] Copied ${offset} rows from ${table}`);
  }

  private async verifyRowCounts(
    tables: string[],
    tenantId: string,
    sourceClient: { query: (sql: string, params?: unknown[]) => Promise<{ rows: { count: string }[] }> },
    destKnex: Knex.Knex,
  ): Promise<void> {
    for (const table of tables) {
      const { rows: srcRows } = await sourceClient.query(
        `SELECT COUNT(*) AS count FROM "${table}" WHERE tenant_id = $1`,
        [tenantId],
      );
      const srcCount = Number(srcRows[0]?.count ?? 0);
      const destCount = await destKnex(table)
        .where({ tenant_id: tenantId })
        .count('* as count')
        .then(r => Number((r[0] as any).count));

      if (srcCount !== destCount) {
        throw new Error(`Row count mismatch for ${table}: source=${srcCount}, dest=${destCount}`);
      }
    }
  }
}
