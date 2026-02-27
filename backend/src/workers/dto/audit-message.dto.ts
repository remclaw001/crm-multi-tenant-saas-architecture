// ============================================================
// AuditMessage — published to `audit` exchange by request handlers.
// AuditConsumer writes each message as one row in audit_logs table.
// ============================================================

export interface AuditMessage {
  /** Tenant that owns this event. */
  tenantId: string;
  /** User who triggered the action (null for system events). */
  userId?: string;
  /** Verb.noun format: 'user.created', 'deal.closed', 'plugin.disabled'. */
  action: string;
  /** Affected entity type: 'user', 'contact', 'deal', 'plugin'. */
  resourceType: string;
  /** Affected entity identifier (string for flexibility). */
  resourceId?: string;
  /** Arbitrary JSON: diff, snapshot, or metadata. */
  payload?: Record<string, unknown>;
  /** Client IP address (IPv4 or IPv6). */
  ipAddress?: string;
  /** Correlates with X-Correlation-ID header / trace. */
  correlationId?: string;
  /** ISO-8601 timestamp of the original event. */
  timestamp: string;
}
