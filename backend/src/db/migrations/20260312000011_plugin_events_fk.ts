import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('plugin_events', (t) => {
    t.foreign('tenant_id').references('id').inTable('tenants').onDelete('CASCADE');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('plugin_events', (t) => {
    t.dropForeign(['tenant_id']);
  });
}
