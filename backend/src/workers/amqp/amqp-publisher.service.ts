// ============================================================
// AmqpPublisher — type-safe helper for publishing messages.
//
// Usage (from any NestJS module, AmqpModule is @Global):
//
//   constructor(private readonly publisher: AmqpPublisher) {}
//
//   await this.publisher.publishAudit({ tenantId, action, ... });
//   await this.publisher.publishNotification({ tenantId, ... });
//   await this.publisher.publishSearchIndex({ tenantId, ... });
//   await this.publisher.publishWebhook({ tenantId, ... });
//
// Messages are persistent (deliveryMode: 2) so RabbitMQ survives restart.
// ============================================================
import { Injectable } from '@nestjs/common';
import { AmqpService } from './amqp.service';
import { EXCHANGES, QUEUES } from './amqp-topology.service';
import type { AuditMessage }       from '../dto/audit-message.dto';
import type { NotificationMessage } from '../dto/notification-message.dto';
import type { SearchIndexMessage }  from '../dto/search-index-message.dto';
import type { WebhookMessage }      from '../dto/webhook-message.dto';

@Injectable()
export class AmqpPublisher {
  constructor(private readonly amqp: AmqpService) {}

  publishAudit(message: AuditMessage): void {
    this.publish(EXCHANGES.AUDIT, QUEUES.AUDIT, message);
  }

  publishNotification(message: NotificationMessage): void {
    this.publish(EXCHANGES.NOTIFICATIONS, QUEUES.NOTIFICATIONS, message);
  }

  publishSearchIndex(message: SearchIndexMessage): void {
    this.publish(EXCHANGES.SEARCH_INDEX, QUEUES.SEARCH_INDEX, message);
  }

  publishWebhook(message: WebhookMessage): void {
    this.publish(EXCHANGES.WEBHOOKS, QUEUES.WEBHOOKS, message);
  }

  private publish(exchange: string, routingKey: string, message: unknown): void {
    const ch = this.amqp.getChannel();
    ch.publish(
      exchange,
      routingKey,
      Buffer.from(JSON.stringify(message)),
      {
        contentType:  'application/json',
        persistent:   true,   // survives broker restart (deliveryMode: 2)
      },
    );
  }
}
