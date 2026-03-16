import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('plugin_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.text('event_name').notNullable();
    t.text('plugin').notNullable();
    t.jsonb('payload').notNullable();
    t.text('status').notNullable().defaultTo('pending'); // pending | queued | processed
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('queued_at', { useTz: true }).nullable();
    t.timestamp('expires_at', { useTz: true }).notNullable();
  });

  // Poller: WHERE status='pending' AND expires_at > NOW()
  await knex.raw(`
    CREATE INDEX plugin_events_pending_idx
      ON plugin_events (status, expires_at)
      WHERE status = 'pending'
  `);

  // Stuck-row recovery: WHERE status='queued' AND queued_at < threshold
  await knex.raw(`
    CREATE INDEX plugin_events_queued_idx
      ON plugin_events (status, queued_at)
      WHERE status = 'queued'
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('plugin_events');
}
