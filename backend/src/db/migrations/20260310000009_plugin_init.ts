import type { Knex } from 'knex';

// ============================================================
// V9 — plugin_init: add initialized_at to tenant_plugins
//
// Tracks whether a plugin's first-enable init job has completed
// for a given tenant. NULL = never initialized or init pending.
// Set to NOW() by PluginInitProcessor on job completion.
// ============================================================

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('tenant_plugins', (table) => {
    table.timestamp('initialized_at', { useTz: true }).nullable().defaultTo(null);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('tenant_plugins', (table) => {
    table.dropColumn('initialized_at');
  });
}
