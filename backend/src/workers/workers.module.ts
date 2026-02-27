// ============================================================
// WorkersModule — L5 Async Workers aggregator.
//
// Load order within this module:
//   1. AmqpModule   — connects to RabbitMQ, declares topology
//   2. BullMqModule — connects to Redis, registers queues + processors
//   3. Consumers    — start consuming AFTER AMQP + BullMQ ready
//   4. CronService  — starts scheduled jobs on onApplicationBootstrap
//
// AmqpModule is @Global() → AmqpPublisher available in all modules
// without explicitly importing WorkersModule.
// ============================================================
import { Module }                from '@nestjs/common';
import { AmqpModule }            from './amqp/amqp.module';
import { BullMqModule }          from './bullmq/bullmq.module';
import { AuditConsumer }         from './consumers/audit.consumer';
import { NotificationConsumer }  from './consumers/notification.consumer';
import { SearchIndexConsumer }   from './consumers/search-index.consumer';
import { WebhookConsumer }       from './consumers/webhook.consumer';
import { CronService }           from './scheduler/cron.service';

@Module({
  imports: [
    AmqpModule,    // FIRST — topology declared before consumers start
    BullMqModule,  // SECOND — queues registered before consumers inject them
  ],
  providers: [
    AuditConsumer,
    NotificationConsumer,
    SearchIndexConsumer,
    WebhookConsumer,
    CronService,
  ],
  exports: [AmqpModule],  // re-export so AmqpPublisher is reachable
})
export class WorkersModule {}
