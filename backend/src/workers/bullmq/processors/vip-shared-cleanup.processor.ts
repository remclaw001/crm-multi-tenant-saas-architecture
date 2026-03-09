// ============================================================
// VipSharedCleanupProcessor
//
// Scheduled 24 hours after VipMigrationProcessor completes.
// The 24h window lets the ops team verify the dedicated DB looks
// healthy before the shared DB rows are permanently removed.
//
// Deletes all plugin-table rows for the tenant from the SHARED DB
// (the dedicated VIP DB is already the source of truth at this point).
//
// Audit rows are intentionally NOT deleted — audit_logs has no tenant_id
// column and is retained per compliance policy.
// ============================================================
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_VIP_SHARED_CLEANUP } from '../queue.constants';
import { PoolRegistry } from '../../../dal/pool/PoolRegistry';

const PLUGIN_TABLES = [
  'marketing_campaigns',
  'automation_triggers',
  'support_cases',
  'customers',        // FK-ordered: delete dependents first
] as const;

export interface VipSharedCleanupJobData {
  tenantId: string;
  slug:     string;  // for logging only
}

@Processor(QUEUE_VIP_SHARED_CLEANUP, { concurrency: 1 })
export class VipSharedCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(VipSharedCleanupProcessor.name);

  constructor(private readonly poolRegistry: PoolRegistry) {
    super();
  }

  async process(job: Job<VipSharedCleanupJobData>): Promise<void> {
    const { tenantId, slug } = job.data;
    this.logger.log(
      `[VipSharedCleanup] Deleting shared-DB rows for tenant ${tenantId} (${slug})`,
    );

    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      for (const table of PLUGIN_TABLES) {
        const { rowCount } = await client.query(
          `DELETE FROM "${table}" WHERE tenant_id = $1`,
          [tenantId],
        ) as { rowCount: number };
        this.logger.log(
          `[VipSharedCleanup] Deleted ${rowCount ?? 0} rows from ${table} for tenant ${tenantId}`,
        );
      }
      this.logger.log(
        `[VipSharedCleanup] Completed shared-DB cleanup for tenant ${tenantId}`,
      );
    } finally {
      client.release();
    }
  }
}
