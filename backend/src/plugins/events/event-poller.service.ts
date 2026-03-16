import { Injectable, Inject, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Knex } from 'knex';
import { QUEUE_PLUGIN_EVENTS } from '../../workers/bullmq/queue.constants';

const POLL_INTERVAL_MS = 5_000;
const BATCH_SIZE       = 50;

@Injectable()
export class EventPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventPollerService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject('KNEX_INSTANCE') private readonly knex: Knex,
    @InjectQueue(QUEUE_PLUGIN_EVENTS) private readonly queue: Queue,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async poll(): Promise<void> {
    try {
      // Phase 1: DB transaction — SELECT + UPDATE atomically
      // queue.add() happens AFTER commit so a Redis failure leaves the row
      // in 'queued' status; the stuck-row recovery cron resets it to 'pending'.
      let rows: Array<{
        id: string; event_name: string; tenant_id: string;
        tenant_tier: string; payload: string;
      }> = [];

      await this.knex.transaction(async (trx) => {
        rows = await trx('plugin_events as pe')
          .join('tenants as t', 't.id', 'pe.tenant_id')
          .where('pe.status', 'pending')
          .where('pe.expires_at', '>', this.knex.raw('NOW()'))
          .select(
            'pe.id', 'pe.event_name', 'pe.tenant_id', 'pe.payload',
            't.tier as tenant_tier',
          )
          .forUpdate()
          .skipLocked()
          .limit(BATCH_SIZE);

        if (rows.length === 0) return;

        await trx('plugin_events')
          .whereIn('id', rows.map((r) => r.id))
          .update({ status: 'queued', queued_at: this.knex.raw('NOW()') });
      });

      // Phase 2: enqueue AFTER DB commit
      if (rows.length === 0) return;

      await Promise.all(
        rows.map((row) =>
          this.queue.add(QUEUE_PLUGIN_EVENTS, {
            eventId:    row.id,
            eventName:  row.event_name,
            tenantId:   row.tenant_id,
            tenantTier: row.tenant_tier,
            payload:    JSON.parse(row.payload) as Record<string, unknown>,
          }),
        ),
      );

      this.logger.debug(`[EventPoller] queued ${rows.length} event(s)`);
    } catch (err) {
      this.logger.error('[EventPoller] poll error', err);
    }
  }
}
