// ============================================================
// CronService — node-cron scheduled jobs.
//
// Jobs:
//   cleanup-sessions  (daily @ 02:00)
//     → Delete expired sessions from Redis (pattern: sess:*)
//       Redis TTL handles most expiry, cron catches edge cases.
//       In production this would also clear expired DB tokens.
//
//   report-queue-depth (every 5 minutes)
//     → Log BullMQ queue depths for operational visibility.
//       (Prometheus MetricsController already exposes this via prom-client
//        for Grafana — this cron is an additional console summary.)
// ============================================================
import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue }  from 'bullmq';
import * as cron       from 'node-cron';
import { QUEUE_EMAIL, QUEUE_WEBHOOK } from '../bullmq/queue.constants';
import { PoolRegistry } from '../../dal/pool/PoolRegistry';

@Injectable()
export class CronService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(CronService.name);
  private readonly tasks: cron.ScheduledTask[] = [];

  constructor(
    @InjectQueue(QUEUE_EMAIL)   private readonly emailQueue:   Queue,
    @InjectQueue(QUEUE_WEBHOOK) private readonly webhookQueue: Queue,
    private readonly poolRegistry: PoolRegistry,
  ) {}

  onApplicationBootstrap(): void {
    // ── Daily at 02:00 — cleanup expired sessions ────────────
    this.tasks.push(
      cron.schedule('0 2 * * *', () => this.cleanupSessions(), {
        name: 'cleanup-sessions',
      })
    );

    // ── Every 5 minutes — log queue depth ────────────────────
    this.tasks.push(
      cron.schedule('*/5 * * * *', () => this.reportQueueDepth(), {
        name: 'report-queue-depth',
      })
    );

    // ── Daily at 03:00 — hard delete tenants offboarded 90+ days ago ─
    this.tasks.push(
      cron.schedule('0 3 * * *', () => this.hardDeleteOffboardedTenants(), {
        name: 'hard-delete-offboarded',
      })
    );

    this.logger.log('CronService started (3 jobs scheduled)');
  }

  onApplicationShutdown(): void {
    for (const task of this.tasks) {
      task.stop();
    }
  }

  private cleanupSessions(): void {
    // In a real system: clear expired DB session tokens, stale cache keys, etc.
    // Redis TTL handles most expiry automatically — this is a safety net.
    this.logger.debug('cron:cleanup-sessions — running session cleanup');
  }

  private async hardDeleteOffboardedTenants(): Promise<void> {
    this.logger.log('cron:hard-delete — checking for tenants to permanently delete');
    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      const { rows: tenants } = await client.query<{ id: string }>(
        `SELECT id FROM tenants
         WHERE status = 'offboarded'
           AND offboarded_at < NOW() - INTERVAL '90 days'`,
      );

      if (tenants.length === 0) {
        this.logger.debug('cron:hard-delete — no tenants qualify');
        return;
      }

      this.logger.log(`cron:hard-delete — permanently deleting ${tenants.length} tenant(s)`);

      for (const { id } of tenants) {
        try {
          // FK-ordered deletes — audit_logs intentionally kept
          for (const table of [
            'marketing_campaigns', 'automation_triggers',
            'support_cases', 'customers',
          ]) {
            await client.query(`DELETE FROM "${table}" WHERE tenant_id = $1`, [id]);
          }
          await client.query('DELETE FROM refresh_tokens  WHERE tenant_id = $1', [id]);
          await client.query('DELETE FROM user_roles      WHERE tenant_id = $1', [id]);
          await client.query('DELETE FROM users           WHERE tenant_id = $1', [id]);
          await client.query('DELETE FROM roles           WHERE tenant_id = $1', [id]);
          await client.query('DELETE FROM tenant_plugins  WHERE tenant_id = $1', [id]);
          await client.query('DELETE FROM tenants         WHERE id        = $1', [id]);
          this.logger.log(`cron:hard-delete — permanently deleted tenant ${id}`);
        } catch (err) {
          this.logger.error(`cron:hard-delete — failed to delete tenant ${id}:`, err);
        }
      }
    } finally {
      client.release();
    }
  }

  private async reportQueueDepth(): Promise<void> {
    try {
      const [emailWaiting, emailFailed, webhookWaiting, webhookFailed] =
        await Promise.all([
          this.emailQueue.getWaitingCount(),
          this.emailQueue.getFailedCount(),
          this.webhookQueue.getWaitingCount(),
          this.webhookQueue.getFailedCount(),
        ]);

      this.logger.debug(
        `Queue depth — email: waiting=${emailWaiting} failed=${emailFailed} | ` +
        `webhook: waiting=${webhookWaiting} failed=${webhookFailed}`
      );
    } catch (err) {
      this.logger.warn('cron:report-queue-depth failed', err);
    }
  }
}
