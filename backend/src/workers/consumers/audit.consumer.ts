// ============================================================
// AuditConsumer — consumes from `audit.queue`, writes to audit_logs.
//
// Critical path design:
//   - prefetch(1): process one message at a time, backpressure from DB
//   - ack on success, nack(requeue=false) on parse/write error → DLQ
//   - Uses raw Knex INSERT (bypasses QueryInterceptor — audit worker
//     runs outside tenant session context, writes via metadata pool).
// ============================================================
import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Logger,
  Inject,
} from '@nestjs/common';
import type { Channel, ConsumeMessage } from 'amqplib';
import type { Knex } from 'knex';
import { AmqpService }     from '../amqp/amqp.service';
import { QUEUES }          from '../amqp/amqp-topology.service';
import type { AuditMessage } from '../dto/audit-message.dto';

@Injectable()
export class AuditConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(AuditConsumer.name);
  private channel: Channel | null = null;

  constructor(
    private readonly amqp: AmqpService,
    @Inject('KNEX_INSTANCE') private readonly knex: Knex,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.channel = await this.amqp.createChannel();
    await this.channel.prefetch(1);
    await this.channel.consume(QUEUES.AUDIT, (msg) => this.handleMessage(msg));
    this.logger.log('AuditConsumer started');
  }

  async onApplicationShutdown(): Promise<void> {
    try { await this.channel?.close(); } catch { /* ignore */ }
  }

  private async handleMessage(msg: ConsumeMessage | null): Promise<void> {
    if (!msg || !this.channel) return;

    let data: AuditMessage;
    try {
      data = JSON.parse(msg.content.toString()) as AuditMessage;
    } catch (err) {
      this.logger.error('AuditConsumer: failed to parse message', err);
      this.channel.nack(msg, false, false); // → DLQ (malformed)
      return;
    }

    try {
      await this.knex('audit_logs').insert({
        tenant_id:      data.tenantId,
        user_id:        data.userId       ?? null,
        action:         data.action,
        resource_type:  data.resourceType,
        resource_id:    data.resourceId   ?? null,
        payload:        JSON.stringify(data.payload ?? {}),
        ip_address:     data.ipAddress    ?? null,
        correlation_id: data.correlationId ?? null,
        created_at:     data.timestamp,
      });
      this.channel.ack(msg);
    } catch (err) {
      this.logger.error(
        `AuditConsumer: DB write failed for action=${data.action}`, err
      );
      // requeue=false → DLQ after one failure (avoid hot-retry loop)
      this.channel.nack(msg, false, false);
    }
  }
}
