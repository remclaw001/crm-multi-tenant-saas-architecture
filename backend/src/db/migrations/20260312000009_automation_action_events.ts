import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('automation_action_events', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table
      .uuid('tenant_id')
      .notNullable()
      .references('id')
      .inTable('tenants')
      .onDelete('CASCADE');
    table
      .uuid('trigger_id')
      .notNullable()
      .references('id')
      .inTable('automation_triggers')
      .onDelete('CASCADE');
    table.integer('action_index').notNullable();
    table.string('action_type', 100).notNullable();
    table.jsonb('action_params').notNullable().defaultTo('{}');
    table.jsonb('trigger_context').notNullable().defaultTo('{}');
    table.string('status', 20).notNullable().defaultTo('pending');
    table.integer('attempts').notNullable().defaultTo(0);
    table.text('last_error').nullable();
    table.timestamp('scheduled_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('queued_at', { useTz: true }).nullable();
    table.timestamp('completed_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(
    `CREATE INDEX idx_action_events_pending ON automation_action_events(scheduled_at) WHERE status = 'pending'`,
  );
  await knex.raw(
    `CREATE INDEX idx_action_events_tenant ON automation_action_events(tenant_id)`,
  );
  await knex.raw(
    `CREATE INDEX idx_action_events_trigger ON automation_action_events(trigger_id)`,
  );
  // NOTE: No RLS — worker uses TenantContext.run() to scope queries manually.
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('automation_action_events');
}
