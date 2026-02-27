// ============================================================
// WebhookConsumer — consumes from `webhooks.queue`,
// enqueues into BullMQ `webhook-delivery` queue for outbound
// HTTP delivery with exponential backoff retry.
//
// BullMQ handles the actual HTTP POST + retry logic so that
// short webhook endpoint outages don't block the consumer.
// ============================================================
import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Channel, ConsumeMessage } from 'amqplib';
import { AmqpService }      from '../amqp/amqp.service';
import { QUEUES }           from '../amqp/amqp-topology.service';
import { QUEUE_WEBHOOK }    from '../bullmq/queue.constants';
import type { WebhookMessage } from '../dto/webhook-message.dto';

@Injectable()
export class WebhookConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(WebhookConsumer.name);
  private channel: Channel | null = null;

  constructor(
    private readonly amqp: AmqpService,
    @InjectQueue(QUEUE_WEBHOOK) private readonly webhookQueue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.channel = await this.amqp.createChannel();
    await this.channel.prefetch(10);
    await this.channel.consume(QUEUES.WEBHOOKS, (msg) =>
      this.handleMessage(msg)
    );
    this.logger.log('WebhookConsumer started');
  }

  async onApplicationShutdown(): Promise<void> {
    try { await this.channel?.close(); } catch { /* ignore */ }
  }

  private async handleMessage(msg: ConsumeMessage | null): Promise<void> {
    if (!msg || !this.channel) return;

    let data: WebhookMessage;
    try {
      data = JSON.parse(msg.content.toString()) as WebhookMessage;
    } catch (err) {
      this.logger.error('WebhookConsumer: failed to parse message', err);
      this.channel.nack(msg, false, false);
      return;
    }

    try {
      await this.webhookQueue.add(
        'deliver-webhook',
        data,
        {
          attempts: 7,
          backoff:  { type: 'exponential', delay: 1_000 }, // 1s, 2s, 4s … ~64s
          removeOnComplete: { count: 200 },
          removeOnFail:     { count: 100 },
        },
      );
      this.channel.ack(msg);
    } catch (err) {
      this.logger.error('WebhookConsumer: failed to enqueue job', err);
      this.channel.nack(msg, false, false);
    }
  }
}
