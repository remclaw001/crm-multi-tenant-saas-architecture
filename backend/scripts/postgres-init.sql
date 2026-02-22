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
