import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // 1. Add status column (text, not null, default 'active')
  await knex.schema.alterTable('tenants', (table) => {
    table.string('status', 50).notNullable().defaultTo('active');
  });

  // 2. Add check constraint for status enum
  await knex.raw(`
    ALTER TABLE tenants ADD CONSTRAINT tenants_status_check
    CHECK (status IN ('provisioning','active','migrating','grace_period','suspended','offboarding','offboarded'))
  `);

  // 3. Backfill status from is_active
  await knex('tenants').where('is_active', false).update({ status: 'suspended' });
  await knex('tenants').where('is_active', true).update({ status: 'active' });

  // 4. Drop old tier check constraint, add new one
  await knex.raw(`ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_tier_check`);
  await knex.raw(`
    ALTER TABLE tenants ADD CONSTRAINT tenants_tier_check
    CHECK (tier IN ('basic','premium','enterprise','vip','standard'))
  `);

  // 5. Rename 'standard' tier data to 'basic'
  await knex('tenants').where('tier', 'standard').update({ tier: 'basic' });
}

export async function down(knex: Knex): Promise<void> {
  // Revert tier names
  await knex('tenants').where('tier', 'basic').update({ tier: 'standard' });
  await knex.raw(`ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_tier_check`);
  await knex.raw(`
    ALTER TABLE tenants ADD CONSTRAINT tenants_tier_check
    CHECK (tier IN ('standard','vip','enterprise'))
  `);

  // Remove status column
  await knex.schema.alterTable('tenants', (table) => {
    table.dropColumn('status');
  });
}
