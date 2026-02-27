// ============================================================
// WebhookMessage — published to `webhooks` exchange.
// WebhookConsumer enqueues into BullMQ webhook-delivery queue
// for outbound HTTP delivery with retry/backoff.
// ============================================================

export interface WebhookMessage {
  tenantId: string;
  /** Webhook subscription identifier (from tenant's webhook config). */
  webhookId: string;
  /** Target URL to POST to. */
  url: string;
  /** Event type string: 'contact.created', 'deal.won', etc. */
  event: string;
  /** Payload delivered to the endpoint. */
  payload: Record<string, unknown>;
  /** Extra HTTP headers (e.g. HMAC signature header). */
  headers?: Record<string, string>;
}
