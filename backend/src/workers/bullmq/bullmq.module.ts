// ============================================================
// BullMqModule — registers Redis connection + queues + processors.
//
// Uses the same REDIS_URL as ioredis (DalModule) — BullMQ maintains
// its own connection internally via ioredis.
// ============================================================
import { Module }      from '@nestjs/common';
import { BullModule }  from '@nestjs/bullmq';
import { config }      from '../../config/env';
import { QUEUE_EMAIL, QUEUE_WEBHOOK } from './queue.constants';
import { EmailProcessor }         from './processors/email.processor';
import { WebhookRetryProcessor }  from './processors/webhook-retry.processor';

@Module({
  imports: [
    BullModule.forRoot({
      connection: { url: config.REDIS_URL },
    }),
    BullModule.registerQueue(
      { name: QUEUE_EMAIL   },
      { name: QUEUE_WEBHOOK },
    ),
  ],
  providers: [EmailProcessor, WebhookRetryProcessor],
  exports:   [BullModule],  // re-export so consumers can InjectQueue
})
export class BullMqModule {}
