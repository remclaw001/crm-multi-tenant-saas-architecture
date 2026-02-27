// ============================================================
// WebhookRetryProcessor — BullMQ Worker for `webhook-delivery` queue.
//
// Sends outbound HTTP POST to tenant-defined webhook endpoints.
// Uses Node.js built-in fetch (Node 22+, available in env).
//
// HMAC-SHA256 signature added if `x-webhook-secret` is in headers.
//
// Retry strategy (configured by WebhookConsumer):
//   - attempts: 7, backoff: exponential 1s
//   - 2xx response → success
//   - Non-2xx / network error → job fails → BullMQ retries
//   - After 7 attempts → BullMQ failed set
// ============================================================
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger }                from '@nestjs/common';
import { Job }                   from 'bullmq';
import { createHmac }            from 'crypto';
import { QUEUE_WEBHOOK }         from '../queue.constants';
import type { WebhookMessage }   from '../../dto/webhook-message.dto';

const WEBHOOK_TIMEOUT_MS = 10_000;

@Processor(QUEUE_WEBHOOK)
export class WebhookRetryProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookRetryProcessor.name);

  async process(job: Job<WebhookMessage>): Promise<void> {
    const { url, payload, event, tenantId, webhookId, headers = {} } = job.data;

    const body = JSON.stringify({ event, payload, tenantId, webhookId });

    // Build request headers
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-CRM-Event':  event,
      ...headers,
    };

    // HMAC signature (if secret provided in headers map)
    const secret = headers['x-webhook-secret'];
    if (secret) {
      const sig = createHmac('sha256', secret).update(body).digest('hex');
      reqHeaders['X-CRM-Signature'] = `sha256=${sig}`;
      delete reqHeaders['x-webhook-secret']; // don't forward the secret itself
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: reqHeaders,
        body,
        signal:  controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Webhook delivery failed: HTTP ${res.status} from ${url}`);
      }

      this.logger.debug(
        `Webhook delivered: webhookId=${webhookId} event=${event} status=${res.status}`
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
