// ============================================================
// NotificationConsumer — consumes from `notifications.queue`,
// enqueues into BullMQ `email-notifications` queue for
// delivery with exponential backoff retry.
//
// Routing:
//   channel=email   → BullMQ email queue → EmailProcessor
//   channel=push    → BullMQ push queue  (stub — push service TBD)
//   channel=in_app  → direct DB write    (no retry needed, best-effort)
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
import { AmqpService }          from '../amqp/amqp.service';
import { QUEUES }               from '../amqp/amqp-topology.service';
import { QUEUE_EMAIL }          from '../bullmq/queue.constants';
import type { NotificationMessage } from '../dto/notification-message.dto';

@Injectable()
export class NotificationConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(NotificationConsumer.name);
  private channel: Channel | null = null;

  constructor(
    private readonly amqp: AmqpService,
    @InjectQueue(QUEUE_EMAIL) private readonly emailQueue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.channel = await this.amqp.createChannel();
    await this.channel.prefetch(10);
    await this.channel.consume(QUEUES.NOTIFICATIONS, (msg) =>
      this.handleMessage(msg)
    );
    this.logger.log('NotificationConsumer started');
  }

  async onApplicationShutdown(): Promise<void> {
    try { await this.channel?.close(); } catch { /* ignore */ }
  }

  private async handleMessage(msg: ConsumeMessage | null): Promise<void> {
    if (!msg || !this.channel) return;

    let data: NotificationMessage;
    try {
      data = JSON.parse(msg.content.toString()) as NotificationMessage;
    } catch (err) {
      this.logger.error('NotificationConsumer: failed to parse message', err);
      this.channel.nack(msg, false, false);
      return;
    }

    try {
      if (data.channel === 'email') {
        await this.emailQueue.add(
          'send-email',
          data,
          {
            attempts:    5,
            backoff:     { type: 'exponential', delay: 2_000 },
            removeOnComplete: { count: 100 },
            removeOnFail:     { count: 50 },
          },
        );
      } else {
        // push / in_app: log for now (channels not yet implemented)
        this.logger.debug(
          `NotificationConsumer: channel=${data.channel} to=${data.to} (not yet implemented)`
        );
      }
      this.channel.ack(msg);
    } catch (err) {
      this.logger.error('NotificationConsumer: failed to enqueue job', err);
      this.channel.nack(msg, false, false);
    }
  }
}
