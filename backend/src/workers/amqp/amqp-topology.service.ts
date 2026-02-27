// ============================================================
// AmqpTopologyService — Declares exchanges, queues, and DLX bindings.
//
// Called once on module init (before consumers start).
//
// Exchange topology:
//
//   exchange               DLX exchange            DLQ (inspection queue)
//   ──────────────────     ────────────────────     ─────────────────────
//   audit         (direct) → audit.dlx    (direct) → audit.dlq
//   notifications (direct) → notifications.dlx      → notifications.dlq
//   search.index  (direct) → search.index.dlx       → search.index.dlq
//   webhooks      (direct) → webhooks.dlx            → webhooks.dlq
//
// Message flow:
//   Publisher → exchange → queue → consumer
//              (nack/ttl)  ↓ DLX  → DLQ  (manual inspection / replay)
// ============================================================
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { AmqpService } from './amqp.service';

export const EXCHANGES = {
  AUDIT:         'audit',
  NOTIFICATIONS: 'notifications',
  SEARCH_INDEX:  'search.index',
  WEBHOOKS:      'webhooks',
} as const;

export const QUEUES = {
  AUDIT:              'audit.queue',
  NOTIFICATIONS:      'notifications.queue',
  SEARCH_INDEX:       'search.index.queue',
  WEBHOOKS:           'webhooks.queue',
  // Dead-letter queues
  AUDIT_DLQ:          'audit.dlq',
  NOTIFICATIONS_DLQ:  'notifications.dlq',
  SEARCH_INDEX_DLQ:   'search.index.dlq',
  WEBHOOKS_DLQ:       'webhooks.dlq',
} as const;

const DLX_EXCHANGES = {
  AUDIT:         'audit.dlx',
  NOTIFICATIONS: 'notifications.dlx',
  SEARCH_INDEX:  'search.index.dlx',
  WEBHOOKS:      'webhooks.dlx',
} as const;

@Injectable()
export class AmqpTopologyService implements OnModuleInit {
  private readonly logger = new Logger(AmqpTopologyService.name);

  constructor(private readonly amqp: AmqpService) {}

  async onModuleInit(): Promise<void> {
    await this.declareTopology();
  }

  private async declareTopology(): Promise<void> {
    const ch = this.amqp.getChannel();

    // ── Declare DLX exchanges first ──────────────────────────
    for (const dlx of Object.values(DLX_EXCHANGES)) {
      await ch.assertExchange(dlx, 'direct', { durable: true });
    }

    // ── Declare main exchanges ───────────────────────────────
    for (const exchange of Object.values(EXCHANGES)) {
      await ch.assertExchange(exchange, 'direct', { durable: true });
    }

    // ── Declare DLQs and bind to DLX exchanges ───────────────
    const dlqBindings: Array<{ queue: string; exchange: string }> = [
      { queue: QUEUES.AUDIT_DLQ,         exchange: DLX_EXCHANGES.AUDIT },
      { queue: QUEUES.NOTIFICATIONS_DLQ, exchange: DLX_EXCHANGES.NOTIFICATIONS },
      { queue: QUEUES.SEARCH_INDEX_DLQ,  exchange: DLX_EXCHANGES.SEARCH_INDEX },
      { queue: QUEUES.WEBHOOKS_DLQ,      exchange: DLX_EXCHANGES.WEBHOOKS },
    ];
    for (const { queue, exchange } of dlqBindings) {
      await ch.assertQueue(queue, { durable: true });
      await ch.bindQueue(queue, exchange, queue); // routingKey = queue name
    }

    // ── Declare main queues with DLX configured ──────────────
    const queueConfig: Array<{
      queue:    string;
      exchange: string;
      dlx:      string;
      dlq:      string;
    }> = [
      {
        queue:    QUEUES.AUDIT,
        exchange: EXCHANGES.AUDIT,
        dlx:      DLX_EXCHANGES.AUDIT,
        dlq:      QUEUES.AUDIT_DLQ,
      },
      {
        queue:    QUEUES.NOTIFICATIONS,
        exchange: EXCHANGES.NOTIFICATIONS,
        dlx:      DLX_EXCHANGES.NOTIFICATIONS,
        dlq:      QUEUES.NOTIFICATIONS_DLQ,
      },
      {
        queue:    QUEUES.SEARCH_INDEX,
        exchange: EXCHANGES.SEARCH_INDEX,
        dlx:      DLX_EXCHANGES.SEARCH_INDEX,
        dlq:      QUEUES.SEARCH_INDEX_DLQ,
      },
      {
        queue:    QUEUES.WEBHOOKS,
        exchange: EXCHANGES.WEBHOOKS,
        dlx:      DLX_EXCHANGES.WEBHOOKS,
        dlq:      QUEUES.WEBHOOKS_DLQ,
      },
    ];

    for (const { queue, exchange, dlx, dlq } of queueConfig) {
      await ch.assertQueue(queue, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange':    dlx,
          'x-dead-letter-routing-key': dlq,
        },
      });
      await ch.bindQueue(queue, exchange, queue); // routingKey = queue name
    }

    this.logger.log('AMQP topology declared (exchanges + queues + DLX)');
  }
}
