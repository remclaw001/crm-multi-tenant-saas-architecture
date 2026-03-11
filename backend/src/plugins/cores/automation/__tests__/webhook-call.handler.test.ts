import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', mockFetch);

import { WebhookCallHandler } from '../handlers/webhook-call.handler';
import type { ActionCommandContext } from '../handlers/command-handler.interface';

const ctx: ActionCommandContext = {
  tenantId: 'tenant-1',
  eventId: 'event-1',
  triggerId: 'trigger-1',
  triggerContext: { customer: { name: 'Alice', email: 'alice@example.com' } },
};

describe('WebhookCallHandler', () => {
  let handler: WebhookCallHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    handler = new WebhookCallHandler();
  });

  it('has correct actionType', () => {
    expect(handler.actionType).toBe('webhook.call');
  });

  it('calls fetch with resolved URL, method, and body', async () => {
    await handler.execute(ctx, {
      url: 'https://example.com/hook',
      method: 'POST',
      body: '{"name":"{{customer.name}}"}',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.objectContaining({
        method: 'POST',
        body: '{"name":"Alice"}',
      }),
    );
  });

  it('calls fetch without body when body param is omitted', async () => {
    await handler.execute(ctx, { url: 'https://example.com/hook', method: 'GET' });
    const [, options] = mockFetch.mock.calls[0];
    expect(options.body).toBeUndefined();
  });

  it('throws when fetch response is not ok', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' });
    await expect(
      handler.execute(ctx, { url: 'https://example.com/hook', method: 'POST' }),
    ).rejects.toThrow('503');
  });
});
