import type { Knex } from 'knex';

// ============================================================
// V2 — tenant_plugins table
//
// Tracks which plugins are enabled per tenant.
// Used by PluginRegistryService to load enabled plugins at
// request time (cache-first, 5 min TTL).
//
// No RLS — this is a system metadata table read by middleware
// before the tenant execution context is fully established.
// ============================================================

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('tenant_plugins', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table
      .uuid('tenant_id')
      .notNullable()
      .references('id')
      .inTable('tenants')
      .onDelete('CASCADE');
    table.string('plugin_name', 100).notNullable();
    table.jsonb('config').notNullable().defaultTo('{}');
    table.boolean('is_enabled').notNullable().defaultTo(true);
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    // Each tenant can have each plugin registered only once
    table.unique(['tenant_id', 'plugin_name']);
  });

  // Composite index for the hot query path:
  // SELECT plugin_name FROM tenant_plugins WHERE tenant_id=$1 AND is_enabled=true
  await knex.raw('CREATE INDEX ON tenant_plugins (tenant_id, is_enabled)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('tenant_plugins');
}
