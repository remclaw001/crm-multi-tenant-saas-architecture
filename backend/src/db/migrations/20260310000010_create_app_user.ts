import type { Knex } from 'knex';

// ============================================================
// Migration: create crm_app non-superuser for app queries
//
// Context: Docker's POSTGRES_USER creates 'crm' as a PostgreSQL
// SUPERUSER. Superusers bypass RLS even with FORCE ROW LEVEL
// SECURITY — only non-superuser roles are subject to the policy.
//
// This migration creates 'crm_app' with NOSUPERUSER so that
// FORCE ROW LEVEL SECURITY on the users, customers, etc. tables
// actually enforces tenant isolation at the database layer.
//
// After running this migration, set DATABASE_APP_URL in .env:
//   DATABASE_APP_URL=postgresql://crm_app:crm_app@localhost:5432/crm_dev
// ============================================================

export async function up(knex: Knex): Promise<void> {
  // Create non-superuser if it doesn't exist yet.
  // EXECUTE is required for DDL inside PL/pgSQL blocks.
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
        EXECUTE format(
          'CREATE USER crm_app WITH PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE LOGIN',
          'crm_app'
        );
      END IF;
    END;
    $$
  `);

  // Grant schema-level access
  await knex.raw(`GRANT USAGE ON SCHEMA public TO crm_app`);

  // Grant DML on all tables that exist right now (created by prior migrations)
  await knex.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crm_app`);

  // Grant sequence access for any uuid/serial columns in existing tables
  await knex.raw(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crm_app`);

  // Grant DML on tables/sequences created by future migrations.
  // Use current_user instead of hardcoding 'crm' so this works on any
  // PostgreSQL host (Railway, Supabase, etc.) regardless of admin username.
  await knex.raw(`
    DO $$
    DECLARE
      v_owner text := current_user;
    BEGIN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crm_app',
        v_owner
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO crm_app',
        v_owner
      );
    END;
    $$
  `);
}

export async function down(_knex: Knex): Promise<void> {
  // Intentional no-op: dropping a user requires revoking all object privileges
  // first and the user may be referenced by a running application.
  // Revert manually if needed: REASSIGN OWNED BY crm_app TO crm; DROP USER crm_app;
}
