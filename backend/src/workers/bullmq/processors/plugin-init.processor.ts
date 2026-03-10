import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE_PLUGIN_INIT } from '../queue.constants';
import { PoolRegistry } from '../../../dal/pool/PoolRegistry';

export interface PluginInitJobData {
  tenantId: string;
  pluginId: string;
}

@Processor(QUEUE_PLUGIN_INIT, { concurrency: 5 })
export class PluginInitProcessor extends WorkerHost {
  private readonly logger = new Logger(PluginInitProcessor.name);

  constructor(private readonly poolRegistry: PoolRegistry) {
    super();
  }

  async process(job: Job<PluginInitJobData>): Promise<void> {
    const { tenantId, pluginId } = job.data;
    this.logger.log(`[PluginInit] Starting for tenant ${tenantId}, plugin ${pluginId}`);

    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      // Idempotency: re-check initialized_at before doing work (safe on BullMQ retry)
      const { rows } = await client.query<{ initialized_at: string | null }>(
        `SELECT initialized_at FROM tenant_plugins WHERE tenant_id = $1 AND plugin_name = $2`,
        [tenantId, pluginId],
      );
      if (rows[0]?.initialized_at) {
        this.logger.log(`[PluginInit] Already initialized — skipping`);
        return;
      }
      if (!rows[0]) {
        throw new Error(
          `[PluginInit] No tenant_plugins row found for tenant=${tenantId} plugin=${pluginId} — will retry`,
        );
      }

      // Per-plugin init logic (Phase 5: all no-ops — tables already exist in shared schema)
      await this.runInitFor(pluginId, tenantId);

      // Mark complete
      await client.query(
        `UPDATE tenant_plugins SET initialized_at = NOW() WHERE tenant_id = $1 AND plugin_name = $2`,
        [tenantId, pluginId],
      );

      this.logger.log(`[PluginInit] Completed for tenant ${tenantId}, plugin ${pluginId}`);
    } finally {
      client.release();
    }
  }

  // Extension point for Phase 6 plugins to add real init logic.
  private async runInitFor(pluginId: string, _tenantId: string): Promise<void> {
    switch (pluginId) {
      case 'customer-data':
      case 'customer-care':
      case 'analytics':
      case 'automation':
      case 'marketing':
        this.logger.debug(`[PluginInit] No-op init for built-in plugin: ${pluginId}`);
        break;
      default:
        this.logger.warn(`[PluginInit] Unknown plugin '${pluginId}' — skipping init`);
    }
  }
}
