import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS offboarded_at TIMESTAMPTZ NULL`);

  await knex.schema.createTable('vip_db_registry', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants');
    t.text('db_name').notNullable();
    t.text('db_url').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('migrated_at', { useTz: true }).nullable();
    t.timestamp('decommissioned_at', { useTz: true }).nullable();
  });

  await knex.raw('CREATE INDEX idx_vip_db_registry_tenant ON vip_db_registry(tenant_id)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('vip_db_registry');
  await knex.raw(`ALTER TABLE tenants DROP COLUMN IF EXISTS offboarded_at`);
}
