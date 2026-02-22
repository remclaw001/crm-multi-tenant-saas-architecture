import type { Knex } from 'knex';

// ============================================================
// V1 — Initial schema
//
// Bảng KHÔNG có RLS (system tables):
//   - tenants       ← tra cứu tenant khi resolve request
//   - permissions   ← permission definitions toàn cục
//
// Bảng CÓ RLS (tenant-scoped):
//   - users, roles, user_roles
//   Policy: tenant_id = current_setting('app.tenant_id', true)::uuid
//   FORCE ROW LEVEL SECURITY bật để cả owner cũng bị chặn
//   → query không có SET app.tenant_id trả về 0 rows
// ============================================================

export async function up(knex: Knex): Promise<void> {
  // ── Extensions ──────────────────────────────────────────
  // Đã được tạo bởi scripts/postgres-init.sql, dùng IF NOT EXISTS
  // để migration idempotent nếu chạy lại trên DB khác
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  // ── tenants (no RLS — system table) ─────────────────────
  await knex.schema.createTable('tenants', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.string('name', 255).notNullable();
    table.string('subdomain', 100).notNullable().unique();

    // 'standard' → shared pool + shared DB
    // 'vip'      → dedicated pool (30 conns) + shared DB
    // 'enterprise' → dedicated pool + dedicated DB instance
    table.enum('tier', ['standard', 'vip', 'enterprise'])
      .notNullable()
      .defaultTo('standard');

    // Chỉ set cho VIP/Enterprise — URL đến dedicated DB instance
    table.string('db_url', 1000).nullable();

    // JSON config: plugin list, feature flags, CORS origins, etc.
    table.jsonb('config').notNullable().defaultTo('{}');

    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamps(true, true);
  });

  // ── permissions (no RLS — global definitions) ────────────
  await knex.schema.createTable('permissions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    // Format: '<resource>:<action>'  e.g. 'customers:read'
    table.string('name', 100).notNullable().unique();
    table.text('description');
    table.timestamps(true, true);
  });

  // ── users (RLS) ──────────────────────────────────────────
  await knex.schema.createTable('users', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    table.string('email', 255).notNullable();
    table.string('password_hash', 255).notNullable();
    table.string('name', 255).notNullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamps(true, true);

    // Email unique per tenant (không phải global)
    table.unique(['tenant_id', 'email']);
  });

  // ── roles (RLS) ──────────────────────────────────────────
  await knex.schema.createTable('roles', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    table.string('name', 100).notNullable();
    table.text('description');
    table.timestamps(true, true);

    // Role name unique per tenant
    table.unique(['tenant_id', 'name']);
  });

  // ── user_roles (RLS junction) ────────────────────────────
  await knex.schema.createTable('user_roles', (table) => {
    table.uuid('user_id').notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    table.uuid('role_id').notNullable()
      .references('id').inTable('roles').onDelete('CASCADE');
    // Denormalized tenant_id để RLS policy có thể áp dụng
    table.uuid('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    table.primary(['user_id', 'role_id']);
  });

  // ── role_permissions (no RLS — roles are tenant-scoped) ─
  await knex.schema.createTable('role_permissions', (table) => {
    table.uuid('role_id').notNullable()
      .references('id').inTable('roles').onDelete('CASCADE');
    table.uuid('permission_id').notNullable()
      .references('id').inTable('permissions').onDelete('CASCADE');
    table.primary(['role_id', 'permission_id']);
  });

  // ── Indexes for performance ──────────────────────────────
  await knex.raw('CREATE INDEX idx_users_tenant_id ON users(tenant_id)');
  await knex.raw('CREATE INDEX idx_roles_tenant_id ON roles(tenant_id)');
  await knex.raw('CREATE INDEX idx_user_roles_tenant_id ON user_roles(tenant_id)');
  await knex.raw('CREATE INDEX idx_tenants_subdomain ON tenants(subdomain)');

  // ── Row-Level Security ────────────────────────────────────
  // ENABLE: bật RLS
  // FORCE:  áp dụng cả với owner (crm user) — query "trần" trả về 0 rows
  await knex.raw('ALTER TABLE users ENABLE ROW LEVEL SECURITY');
  await knex.raw('ALTER TABLE users FORCE ROW LEVEL SECURITY');

  await knex.raw('ALTER TABLE roles ENABLE ROW LEVEL SECURITY');
  await knex.raw('ALTER TABLE roles FORCE ROW LEVEL SECURITY');

  await knex.raw('ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY');
  await knex.raw('ALTER TABLE user_roles FORCE ROW LEVEL SECURITY');

  // RLS Policies
  // USING    → filter khi SELECT / UPDATE / DELETE
  // WITH CHECK → validate khi INSERT / UPDATE
  // current_setting('app.tenant_id', true) → trả về NULL (không throw)
  //   khi session variable chưa được set → 0 rows trả về
  await knex.raw(`
    CREATE POLICY tenant_isolation ON users
      USING     (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
  `);

  await knex.raw(`
    CREATE POLICY tenant_isolation ON roles
      USING     (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
  `);

  await knex.raw(`
    CREATE POLICY tenant_isolation ON user_roles
      USING     (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Drop theo thứ tự ngược FK
  await knex.schema.dropTableIfExists('role_permissions');
  await knex.schema.dropTableIfExists('user_roles');
  await knex.schema.dropTableIfExists('permissions');
  await knex.schema.dropTableIfExists('roles');
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('tenants');
}
