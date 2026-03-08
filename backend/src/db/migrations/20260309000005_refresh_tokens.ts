// backend/src/db/migrations/20260309000005_refresh_tokens.ts
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('refresh_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    // SHA-256 hex of the opaque token sent to the client (never store plaintext)
    t.string('token_hash', 255).notNullable().unique();
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('revoked_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // Primary lookup: hash → token record
  await knex.raw(
    'CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash)'
  );
  // Cleanup queries: find all active tokens for a user
  await knex.raw(
    'CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id, tenant_id) WHERE revoked_at IS NULL'
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('refresh_tokens');
}
