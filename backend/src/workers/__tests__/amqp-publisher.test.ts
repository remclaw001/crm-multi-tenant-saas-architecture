// ============================================================
// AmqpPublisher unit tests
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AmqpPublisher }      from '../amqp/amqp-publisher.service';
import { AmqpService }        from '../amqp/amqp.service';
import { EXCHANGES, QUEUES }  from '../amqp/amqp-topology.service';
import type { AuditMessage }  from '../dto/audit-message.dto';

function makeChannel() {
  return { publish: vi.fn() };
}

function makeAmqpService(channel = makeChannel()) {
  return {
    getChannel: vi.fn().mockReturnValue(channel),
  } as unknown as AmqpService;
}

describe('AmqpPublisher', () => {
  let publisher: AmqpPublisher;
  let channel: ReturnType<typeof makeChannel>;

  beforeEach(() => {
    channel = makeChannel();
    publisher = new AmqpPublisher(makeAmqpService(channel));
  });

  it('publishes an audit message to the audit exchange', () => {
    const msg: AuditMessage = {
      tenantId: 'tenant-1',
      action:   'user.created',
      resourceType: 'user',
      timestamp: new Date().toISOString(),
    };
    publisher.publishAudit(msg);

    expect(channel.publish).toHaveBeenCalledOnce();
    const [exchange, routingKey, buffer, opts] = channel.publish.mock.calls[0];
    expect(exchange).toBe(EXCHANGES.AUDIT);
    expect(routingKey).toBe(QUEUES.AUDIT);
    expect(JSON.parse(buffer.toString())).toMatchObject({ action: 'user.created' });
    expect(opts.persistent).toBe(true);
  });

  it('publishes a notification message', () => {
    publisher.publishNotification({
      tenantId: 't1', userId: 'u1', channel: 'email',
      to: 'user@example.com', body: 'Hello',
    });

    const [exchange, routingKey] = channel.publish.mock.calls[0];
    expect(exchange).toBe(EXCHANGES.NOTIFICATIONS);
    expect(routingKey).toBe(QUEUES.NOTIFICATIONS);
  });

  it('publishes a search index message', () => {
    publisher.publishSearchIndex({
      tenantId: 't1', operation: 'index',
      index: 'contacts', documentId: 'doc-1',
      document: { name: 'Alice' },
    });

    const [exchange] = channel.publish.mock.calls[0];
    expect(exchange).toBe(EXCHANGES.SEARCH_INDEX);
  });

  it('publishes a webhook message', () => {
    publisher.publishWebhook({
      tenantId: 't1', webhookId: 'wh-1',
      url: 'https://example.com/hook', event: 'contact.created',
      payload: { id: '123' },
    });

    const [exchange] = channel.publish.mock.calls[0];
    expect(exchange).toBe(EXCHANGES.WEBHOOKS);
  });

  it('serialises message content as JSON Buffer', () => {
    publisher.publishAudit({
      tenantId: 't1', action: 'deal.closed',
      resourceType: 'deal', timestamp: '2026-02-28T00:00:00Z',
      resourceId: 'deal-42',
    });

    const [,, buffer] = channel.publish.mock.calls[0];
    const parsed = JSON.parse(buffer.toString());
    expect(parsed.resourceId).toBe('deal-42');
  });

  it('sets persistent=true on every message', () => {
    publisher.publishAudit({
      tenantId: 't1', action: 'x', resourceType: 'y',
      timestamp: '2026-02-28T00:00:00Z',
    });
    const [,,, opts] = channel.publish.mock.calls[0];
    expect(opts.persistent).toBe(true);
  });

  it('sets contentType=application/json', () => {
    publisher.publishAudit({
      tenantId: 't1', action: 'x', resourceType: 'y',
      timestamp: '2026-02-28T00:00:00Z',
    });
    const [,,, opts] = channel.publish.mock.calls[0];
    expect(opts.contentType).toBe('application/json');
  });
});
