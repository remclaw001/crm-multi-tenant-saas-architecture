// ============================================================
// WebhookRetryProcessor unit tests
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookRetryProcessor } from '../bullmq/processors/webhook-retry.processor';
import type { Job }              from 'bullmq';
import type { WebhookMessage }   from '../dto/webhook-message.dto';

function makeJob(data: WebhookMessage): Job<WebhookMessage> {
  return { data } as Job<WebhookMessage>;
}

const sampleWebhook: WebhookMessage = {
  tenantId:  'tenant-1',
  webhookId: 'wh-1',
  url:       'https://example.com/webhook',
  event:     'contact.created',
  payload:   { id: 'contact-99' },
};

describe('WebhookRetryProcessor', () => {
  let processor: WebhookRetryProcessor;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    processor = new WebhookRetryProcessor();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends POST to the webhook URL with correct headers', async () => {
    await processor.process(makeJob(sampleWebhook));

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.com/webhook');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers['X-CRM-Event']).toBe('contact.created');
  });

  it('includes event and payload in request body', async () => {
    await processor.process(makeJob(sampleWebhook));

    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.event).toBe('contact.created');
    expect(body.payload).toEqual({ id: 'contact-99' });
    expect(body.tenantId).toBe('tenant-1');
    expect(body.webhookId).toBe('wh-1');
  });

  it('throws on non-2xx response (BullMQ will retry)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    await expect(processor.process(makeJob(sampleWebhook))).rejects.toThrow(
      'HTTP 503'
    );
  });

  it('throws on network error (BullMQ will retry)', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(processor.process(makeJob(sampleWebhook))).rejects.toThrow(
      'ECONNREFUSED'
    );
  });

  it('adds HMAC signature and strips x-webhook-secret from forwarded headers', async () => {
    const webhookWithSecret: WebhookMessage = {
      ...sampleWebhook,
      headers: { 'x-webhook-secret': 'my-secret', 'X-Custom': 'value' },
    };

    await processor.process(makeJob(webhookWithSecret));

    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['X-CRM-Signature']).toMatch(/^sha256=/);
    expect(opts.headers['x-webhook-secret']).toBeUndefined();
    expect(opts.headers['X-Custom']).toBe('value');
  });

  it('HMAC signature is consistent for same payload', async () => {
    const webhookWithSecret: WebhookMessage = {
      ...sampleWebhook,
      headers: { 'x-webhook-secret': 'consistent-secret' },
    };

    await processor.process(makeJob(webhookWithSecret));
    const [, opts1] = fetchMock.mock.calls[0];
    const sig1 = opts1.headers['X-CRM-Signature'];

    fetchMock.mockClear();
    await processor.process(makeJob(webhookWithSecret));
    const [, opts2] = fetchMock.mock.calls[0];
    const sig2 = opts2.headers['X-CRM-Signature'];

    expect(sig1).toBe(sig2);
  });
});
