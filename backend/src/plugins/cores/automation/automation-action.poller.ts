import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Knex } from 'knex';
import type { Queue } from 'bullmq';
import * as cron from 'node-cron';
import { QUEUE_AUTOMATION_ACTIONS } from '../../../workers/bullmq/queue.constants';

export interface AutomationActionJobData {
  eventId: string;
  tenantId: string;
  triggerId: string;
  actionIndex: number;
  actionType: string;
  actionParams: Record<string, unknown>;
  triggerContext: Record<string, unknown>;
}

const BATCH_SIZE = 50;

@Injectable()
export class AutomationActionPoller implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutomationActionPoller.name);
  private task: cron.ScheduledTask | undefined;

  constructor(
    @Inject('KNEX_INSTANCE') private readonly knex: Knex,
    @InjectQueue(QUEUE_AUTOMATION_ACTIONS) private readonly queue: Queue,
  ) {}

  onModuleInit(): void {
    this.task = cron.schedule('*/5 * * * * *', () => {
      this.poll().catch((err) =>
        this.logger.error('[AutomationActionPoller] Poll error:', err),
      );
    });
  }

  onModuleDestroy(): void {
    this.task?.stop();
  }

  async poll(): Promise<void> {
    const claimed = await this.knex.transaction(async (trx) => {
      const rows = await trx('automation_action_events')
        .select('*')
        .where({ status: 'pending' })
        .orderBy('scheduled_at', 'asc')
        .limit(BATCH_SIZE)
        .forUpdate()
        .skipLocked()
        .returning('*');

      if (rows.length === 0) return [];

      const ids = rows.map((r: { id: string }) => r.id);
      await trx('automation_action_events')
        .whereIn('id', ids)
        .update({ status: 'queued', queued_at: trx.raw('NOW()') });

      return rows;
    });

    for (const event of claimed) {
      await this.queue.add(
        'execute-action',
        {
          eventId: event.id,
          tenantId: event.tenant_id,
          triggerId: event.trigger_id,
          actionIndex: event.action_index,
          actionType: event.action_type,
          actionParams: event.action_params,
          triggerContext: event.trigger_context,
        } satisfies AutomationActionJobData,
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        },
      );
    }

    if (claimed.length > 0) {
      this.logger.debug(`[AutomationActionPoller] Queued ${claimed.length} action events`);
    }
  }
}
