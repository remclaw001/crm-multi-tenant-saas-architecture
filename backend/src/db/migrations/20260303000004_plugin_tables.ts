import type { Knex } from 'knex';

// ============================================================
// V4 — Plugin tables
//
// Bảng CÓ RLS (tenant-scoped):
//   - customers            ← Customer Data plugin
//   - support_cases        ← Customer Care plugin (FK → customers)
//   - automation_triggers  ← Automation plugin
//   - marketing_campaigns  ← Marketing plugin
//
// All tables use FORCE ROW LEVEL SECURITY so even the DB owner
// cannot read cross-tenant rows without setting app.tenant_id.
// ============================================================

export async function up(knex: Knex): Promise<void> {
  // ── customers (RLS) ─────────────────────────────────────
  await knex.schema.createTable('customers', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table
      .uuid('tenant_id')
      .notNullable()
      .references('id')
      .inTable('tenants')
      .onDelete('CASCADE');
    table.text('name').notNullable();
    table.text('email').nullable();
    table.string('phone', 50).nullable();
    table.text('company').nullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  // ── support_cases (RLS) ──────────────────────────────────
  await knex.schema.createTable('support_cases', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table
      .uuid('tenant_id')
      .notNullable()
      .references('id')
      .inTable('tenants')
      .onDelete('CASCADE');
    table
      .uuid('customer_id')
      .notNullable()
      .references('id')
      .inTable('customers')
      .onDelete('CASCADE');
    table.string('title', 500).notNullable();
    table.text('description').nullable();
    table.text('status').notNullable().defaultTo('open');
    table.text('priority').notNullable().defaultTo('medium');
    table
      .uuid('assigned_to')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');
    table.timestamp('resolved_at', { useTz: true }).nullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  // ── automation_triggers (RLS) ────────────────────────────
  await knex.schema.createTable('automation_triggers', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table
      .uuid('tenant_id')
      .notNullable()
      .references('id')
      .inTable('tenants')
      .onDelete('CASCADE');
    table.string('name', 255).notNullable();
    table.string('event_type', 100).notNullable();
    table.jsonb('conditions').notNullable().defaultTo('{}');
    table.jsonb('actions').notNullable().defaultTo('[]');
    table.boolean('is_active').notNullable().defaultTo(true);
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  // ── marketing_campaigns (RLS) ────────────────────────────
  await knex.schema.createTable('marketing_campaigns', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table
      .uuid('tenant_id')
      .notNullable()
      .references('id')
      .inTable('tenants')
      .onDelete('CASCADE');
    table.string('name', 255).notNullable();
    table.text('status').notNullable().defaultTo('draft');
    table.text('campaign_type').notNullable().defaultTo('email');
    table.integer('target_count').notNullable().defaultTo(0);
    table.integer('sent_count').notNullable().defaultTo(0);
    table.timestamp('scheduled_at', { useTz: true }).nullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  // ── Indexes ──────────────────────────────────────────────
  // customers
  await knex.raw('CREATE INDEX idx_customers_tenant_id ON customers(tenant_id)');
  await knex.raw(
    'CREATE INDEX idx_customers_tenant_email ON customers(tenant_id, email) WHERE email IS NOT NULL'
  );

  // support_cases
  await knex.raw(
    'CREATE INDEX idx_support_cases_tenant_id ON support_cases(tenant_id)'
  );
  await knex.raw(
    'CREATE INDEX idx_support_cases_tenant_status ON support_cases(tenant_id, status)'
  );
  await knex.raw(
    'CREATE INDEX idx_support_cases_tenant_customer ON support_cases(tenant_id, customer_id)'
  );

  // automation_triggers
  await knex.raw(
    'CREATE INDEX idx_automation_triggers_tenant_id ON automation_triggers(tenant_id)'
  );
  await knex.raw(
    'CREATE INDEX idx_automation_triggers_tenant_active ON automation_triggers(tenant_id, is_active)'
  );
  await knex.raw(
    'CREATE INDEX idx_automation_triggers_tenant_event ON automation_triggers(tenant_id, event_type)'
  );

  // marketing_campaigns
  await knex.raw(
    'CREATE INDEX idx_marketing_campaigns_tenant_id ON marketing_campaigns(tenant_id)'
  );
  await knex.raw(
    'CREATE INDEX idx_marketing_campaigns_tenant_status ON marketing_campaigns(tenant_id, status)'
  );

  // ── Row-Level Security ────────────────────────────────────
  await knex.raw('ALTER TABLE customers ENABLE ROW LEVEL SECURITY');
  await knex.raw('ALTER TABLE customers FORCE ROW LEVEL SECURITY');

  await knex.raw('ALTER TABLE support_cases ENABLE ROW LEVEL SECURITY');
  await knex.raw('ALTER TABLE support_cases FORCE ROW LEVEL SECURITY');

  await knex.raw('ALTER TABLE automation_triggers ENABLE ROW LEVEL SECURITY');
  await knex.raw('ALTER TABLE automation_triggers FORCE ROW LEVEL SECURITY');

  await knex.raw('ALTER TABLE marketing_campaigns ENABLE ROW LEVEL SECURITY');
  await knex.raw('ALTER TABLE marketing_campaigns FORCE ROW LEVEL SECURITY');

  // RLS Policies
  await knex.raw(`
    CREATE POLICY tenant_isolation ON customers
      USING     (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
  `);

  await knex.raw(`
    CREATE POLICY tenant_isolation ON support_cases
      USING     (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
  `);

  await knex.raw(`
    CREATE POLICY tenant_isolation ON automation_triggers
      USING     (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
  `);

  await knex.raw(`
    CREATE POLICY tenant_isolation ON marketing_campaigns
      USING     (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Drop in reverse FK order
  await knex.schema.dropTableIfExists('marketing_campaigns');
  await knex.schema.dropTableIfExists('automation_triggers');
  await knex.schema.dropTableIfExists('support_cases');
  await knex.schema.dropTableIfExists('customers');
}
