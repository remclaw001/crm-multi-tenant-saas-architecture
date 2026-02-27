// ============================================================
// SearchIndexConsumer — consumes from `search.index.queue`,
// pushes/deletes documents in Elasticsearch.
//
// Graceful degradation: if ELASTICSEARCH_URL is not set or
// the ES client is unavailable, messages are acked after logging
// a warning (search indexing is non-critical — source of truth is DB).
// ============================================================
import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Logger,
} from '@nestjs/common';
import type { Channel, ConsumeMessage } from 'amqplib';
import { Client as ElasticClient } from '@elastic/elasticsearch';
import { AmqpService }         from '../amqp/amqp.service';
import { QUEUES }              from '../amqp/amqp-topology.service';
import type { SearchIndexMessage } from '../dto/search-index-message.dto';
import { config }              from '../../config/env';

@Injectable()
export class SearchIndexConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(SearchIndexConsumer.name);
  private channel: Channel | null = null;
  private readonly es: ElasticClient | null;

  constructor(private readonly amqp: AmqpService) {
    this.es = config.ELASTICSEARCH_URL
      ? new ElasticClient({ node: config.ELASTICSEARCH_URL })
      : null;

    if (!this.es) {
      this.logger.warn(
        'ELASTICSEARCH_URL not set — search indexing disabled (messages will be acked+discarded)'
      );
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    this.channel = await this.amqp.createChannel();
    await this.channel.prefetch(5);
    await this.channel.consume(QUEUES.SEARCH_INDEX, (msg) =>
      this.handleMessage(msg)
    );
    this.logger.log('SearchIndexConsumer started');
  }

  async onApplicationShutdown(): Promise<void> {
    try { await this.channel?.close(); } catch { /* ignore */ }
  }

  private async handleMessage(msg: ConsumeMessage | null): Promise<void> {
    if (!msg || !this.channel) return;

    let data: SearchIndexMessage;
    try {
      data = JSON.parse(msg.content.toString()) as SearchIndexMessage;
    } catch (err) {
      this.logger.error('SearchIndexConsumer: failed to parse message', err);
      this.channel.nack(msg, false, false);
      return;
    }

    // Graceful degradation: no ES configured
    if (!this.es) {
      this.channel.ack(msg);
      return;
    }

    // Prefix index name with tenantId for multi-tenant isolation in ES
    const indexName = `${data.tenantId}-${data.index}`;

    try {
      if (data.operation === 'delete') {
        await this.es.delete({ index: indexName, id: data.documentId });
      } else {
        // 'index' or 'update' — upsert via index API
        await this.es.index({
          index:    indexName,
          id:       data.documentId,
          document: { ...(data.document ?? {}), tenant_id: data.tenantId },
        });
      }
      this.channel.ack(msg);
    } catch (err) {
      this.logger.error(
        `SearchIndexConsumer: ES operation=${data.operation} index=${indexName} failed`, err
      );
      this.channel.nack(msg, false, false); // → DLQ
    }
  }
}
