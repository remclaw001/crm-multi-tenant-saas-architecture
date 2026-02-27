// ============================================================
// NotificationMessage — published to `notifications` exchange.
// NotificationConsumer enqueues into BullMQ email queue for
// delivery with retry/backoff.
// ============================================================

export type NotificationChannel = 'email' | 'push' | 'in_app';

export interface NotificationMessage {
  tenantId: string;
  userId: string;
  channel: NotificationChannel;
  /** Email address (email channel) or device token (push channel). */
  to: string;
  subject?: string;
  body: string;
  /** Arbitrary metadata (e.g. action URL, template vars). */
  metadata?: Record<string, unknown>;
}
