// ============================================================
// Migration: audit_logs table
//
// Stores immutable audit trail records written asynchronously
// by the AuditConsumer via RabbitMQ audit exchange.
//
// Design decisions:
//   - NO RLS: written by internal audit worker (no tenant context session)
//     but tenant_id column provides logical isolation for queries.
//   - created_at only (no updated_at) — audit records are immutable.
//   - resource_id is TEXT (not UUID) to support non-UUID identifiers.
//   - Composite index (tenant_id, created_at DESC) optimises
//     the common query: "show audit log for tenant X, newest first"
// ============================================================
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('audit_logs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    // tenant isolation (no FK — audit worker runs outside tenant pools)
    t.uuid('tenant_id').notNullable();

    // who performed the action (nullable for system-initiated events)
    t.uuid('user_id').nullable();

    // what happened — verb.noun format, e.g. 'user.created', 'deal.closed'
    t.string('action', 100).notNullable();

    // resource type — e.g. 'user', 'contact', 'deal', 'plugin'
    t.string('resource_type', 100).notNullable();

    // resource identifier (text for flexibility — may not be UUID)
    t.text('resource_id').nullable();

    // arbitrary JSON payload — diff, snapshot, metadata
    t.jsonb('payload').defaultTo('{}');

    // network info for security auditing
    t.string('ip_address', 45).nullable();    // IPv4 or IPv6

    // correlates with request trace (X-Correlation-ID header)
    t.string('correlation_id', 100).nullable();

    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // Primary access pattern: audit trail for a tenant, newest first
  await knex.raw(
    'CREATE INDEX idx_audit_logs_tenant_ts ON audit_logs(tenant_id, created_at DESC)'
  );

  // Support filtering by action type within a tenant
  await knex.raw(
    'CREATE INDEX idx_audit_logs_tenant_action ON audit_logs(tenant_id, action)'
  );

  // Support user-level audit queries
  await knex.raw(
    'CREATE INDEX idx_audit_logs_user ON audit_logs(user_id) WHERE user_id IS NOT NULL'
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('audit_logs');
}
