-- ============================================================
-- PostgreSQL initialization — runs as superuser on first start
-- Extensions phải có trước khi Knex migrations chạy
-- ============================================================

-- UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Cryptographic functions (gen_random_bytes, pgp_sym_encrypt...)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Query performance insights (pg_stat_statements view)
-- Requires shared_preload_libraries in postgresql.conf;
-- with Docker image this needs to be set via POSTGRES_INITDB_ARGS
-- or accepted as best-effort at install time.
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA public;

-- ============================================================
-- Application DB user (non-superuser) for Knex runtime queries
--
-- QUAN TRỌNG: App queries PHẢI chạy với user KHÔNG phải superuser.
-- PostgreSQL FORCE ROW LEVEL SECURITY chỉ áp dụng cho table owner
-- và non-superuser roles — superuser luôn bypass RLS, kể cả FORCE.
--
-- Docker's POSTGRES_USER tạo user 'crm' là superuser.
-- 'crm_app' là non-superuser để RLS tenant isolation hoạt động.
--
-- DATABASE_APP_URL trong .env phải trỏ đến user này.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    EXECUTE format(
      'CREATE USER crm_app WITH PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE LOGIN',
      'crm_app'
    );
  END IF;
END;
$$;

-- Grant access to current database (crm_dev)
GRANT CONNECT ON DATABASE crm_dev TO crm_app;

-- Grant schema usage
GRANT USAGE ON SCHEMA public TO crm_app;

-- Grant DML on tables created by 'crm' superuser in future (migrations)
ALTER DEFAULT PRIVILEGES FOR ROLE crm IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crm_app;

-- Grant sequence access for UUID / serial columns
ALTER DEFAULT PRIVILEGES FOR ROLE crm IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO crm_app;
