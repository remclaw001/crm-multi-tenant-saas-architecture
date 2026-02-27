// ============================================================
// AuditConsumer unit tests
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditConsumer }  from '../consumers/audit.consumer';
import type { AuditMessage } from '../dto/audit-message.dto';

// ── Helpers ────────────────────────────────────────────────
function makeChannel() {
  return {
    prefetch: vi.fn().mockResolvedValue(undefined),
    consume:  vi.fn().mockResolvedValue(undefined),
    ack:      vi.fn(),
    nack:     vi.fn(),
  };
}

function makeKnex() {
  const insert = vi.fn().mockResolvedValue([1]);
  const table  = vi.fn().mockReturnValue({ insert });
  return Object.assign(table, { _insert: insert });
}

function makeAmqpService(channel = makeChannel()) {
  return {
    createChannel: vi.fn().mockResolvedValue(channel),
  };
}

function buildMsg(data: AuditMessage) {
  return { content: Buffer.from(JSON.stringify(data)) };
}

// ── Tests ──────────────────────────────────────────────────
describe('AuditConsumer', () => {
  let consumer: AuditConsumer;
  let channel:  ReturnType<typeof makeChannel>;
  let knex:     ReturnType<typeof makeKnex>;

  const sampleMsg: AuditMessage = {
    tenantId:      'tenant-1',
    userId:        'user-1',
    action:        'user.created',
    resourceType:  'user',
    resourceId:    'res-1',
    correlationId: 'corr-1',
    timestamp:     '2026-02-28T00:00:00Z',
  };

  beforeEach(() => {
    channel  = makeChannel();
    knex     = makeKnex();
    consumer = new AuditConsumer(makeAmqpService(channel) as any, knex as any);
  });

  it('sets prefetch(1) and starts consuming on bootstrap', async () => {
    await consumer.onApplicationBootstrap();
    expect(channel.prefetch).toHaveBeenCalledWith(1);
    expect(channel.consume).toHaveBeenCalledWith(
      'audit.queue',
      expect.any(Function),
    );
  });

  it('acks message after successful DB insert', async () => {
    await consumer.onApplicationBootstrap();

    // Extract the handler passed to channel.consume
    const handler = channel.consume.mock.calls[0][1] as (msg: unknown) => Promise<void>;
    await handler(buildMsg(sampleMsg));

    expect(knex._insert).toHaveBeenCalledOnce();
    const inserted = knex._insert.mock.calls[0][0];
    expect(inserted.tenant_id).toBe('tenant-1');
    expect(inserted.action).toBe('user.created');
    expect(channel.ack).toHaveBeenCalledOnce();
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('nacks (no-requeue) on DB error → goes to DLQ', async () => {
    knex._insert.mockRejectedValue(new Error('DB down'));
    await consumer.onApplicationBootstrap();

    const handler = channel.consume.mock.calls[0][1] as (msg: unknown) => Promise<void>;
    await handler(buildMsg(sampleMsg));

    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, false);
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it('nacks on malformed JSON → goes to DLQ', async () => {
    await consumer.onApplicationBootstrap();

    const handler = channel.consume.mock.calls[0][1] as (msg: unknown) => Promise<void>;
    const badMsg  = { content: Buffer.from('{not json') };
    await handler(badMsg);

    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, false);
  });

  it('ignores null message (cancelled consumer)', async () => {
    await consumer.onApplicationBootstrap();
    const handler = channel.consume.mock.calls[0][1] as (msg: unknown) => Promise<void>;
    await expect(handler(null)).resolves.toBeUndefined();
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('maps optional fields correctly (userId = null when missing)', async () => {
    const msgNoUser: AuditMessage = {
      tenantId: 't2', action: 'plugin.disabled',
      resourceType: 'plugin', timestamp: '2026-02-28T00:00:00Z',
    };
    await consumer.onApplicationBootstrap();
    const handler = channel.consume.mock.calls[0][1] as (msg: unknown) => Promise<void>;
    await handler(buildMsg(msgNoUser));

    const inserted = knex._insert.mock.calls[0][0];
    expect(inserted.user_id).toBeNull();
    expect(inserted.resource_id).toBeNull();
  });
});
