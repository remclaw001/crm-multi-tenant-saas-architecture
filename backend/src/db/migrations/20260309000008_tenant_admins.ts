import type { Knex } from 'knex';

// ============================================================
// V8 — tenant_admins table
//
// Stores the designated admin contact(s) for each tenant.
// Created during provisioning (Step 2 of Create Tenant flow).
//
// No FK to users: the admin email is stored independently so
// provisioning can record the contact before an auth user is
// created through the normal login flow.
//
// No RLS: queried by system-admin operations that run outside
// tenant context (e.g. billing notifications, offboard email).
// ============================================================

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('tenant_admins', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('tenant_id')
      .notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    table.string('email', 255).notNullable();
    table.string('role', 50).notNullable().defaultTo('admin');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.raw(
    `CREATE INDEX idx_tenant_admins_tenant_id ON tenant_admins(tenant_id)`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('tenant_admins');
}
