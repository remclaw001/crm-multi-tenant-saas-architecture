# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

```
backend/          NestJS API (L2–L7)
frontend/
  web/            Customer-facing app  — Next.js 15, port 3002
  admin/          Admin console        — Next.js 15, port 3000
  mobile/         React Native (Expo)
docs/             HTML architectural reference docs
```

## Common Commands

All backend commands run from `backend/`.

```bash
# Infrastructure (required before starting the API)
docker compose up -d                          # postgres, redis, rabbitmq
docker compose --profile observability up -d  # + jaeger, prometheus, grafana, loki

# Database
npm run db:migrate          # run pending Knex migrations
npm run db:seed             # seed dev data
npm run db:reset            # rollback-all → migrate → seed
npm run db:status           # show migration status

# Backend
npm run start:dev           # ts-node dev server on port 3000 (set in .env)
npm run build               # tsc compile to dist/

# Tests (backend)
npm test                    # vitest run (unit tests only, no integration)
npm run test:watch          # vitest watch mode
npm run test:ui             # vitest UI

# Frontend (run from the respective directory)
npm run dev    # web → :3002, admin → :3000
npm run build
npm test       # vitest (web, admin); no test runner configured for mobile
```

Integration tests (`src/**/__tests__/integration/`) are excluded from the default test run and require live DB/Redis.

## Environment

Copy `.env.example` to `.env` in `backend/`. Required variables (validated at startup via Zod in `src/config/env.ts`):

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Shared PostgreSQL pool |
| `REDIS_URL` | ioredis |
| `RABBITMQ_URL` | amqplib |
| `JWT_JWKS_URI` **or** `JWT_SECRET_FALLBACK` | One is required; use `JWT_SECRET_FALLBACK` in dev |
| `ENCRYPTION_KEY` | 64 hex chars (32 bytes AES-256-GCM); insecure default exists for dev |

## Backend Architecture

**Framework:** NestJS 10 + TypeScript 5 + Knex (SQL) + ioredis + amqplib + BullMQ

**Module load order** (defined in `src/app.module.ts`, order is mandatory):
1. `DalModule` — `@Global()`: exports `PoolRegistry`, `CacheManager`, `KNEX_INSTANCE`
2. `ObservabilityModule` — Pino logger + OpenTelemetry + Prometheus
3. `SecurityModule` — `@Global()`: `EncryptionService` (AES-256-GCM), `PasswordService` (bcrypt)
4. `WorkersModule` — RabbitMQ (amqplib), BullMQ queues, node-cron
5. `GatewayModule` — middleware pipeline, JWT guard, CORS
6. `HealthModule` — `/health` endpoint
7. `ApiModule` — REST routes under `src/api/v1/`

**Bootstrap import order** (`src/main.ts`) is critical:
1. `tracing.setup` (OpenTelemetry must patch before NestJS loads modules)
2. `sentry.setup`
3. `reflect-metadata`
4. NestJS factories

### L2 Gateway (`src/gateway/`)

Request pipeline (applied in order):
- `CorrelationIdMiddleware` — injects `X-Correlation-ID`
- `TenantResolverMiddleware` — resolves tenant from subdomain/header, stores in `TenantContext`
- `TenantCorsMiddleware` — per-tenant CORS (do **not** call `app.enableCors()`)
- `JwtAuthGuard` — validates JWT via JWKS or fallback secret

### L4 Data Access (`src/dal/`)

- `PoolRegistry` — manages shared (200), metadata (20), and VIP (30 each) connection pools
- `CacheManager` — ioredis wrapper; all keys follow `t:<tenant-id>:<resource-type>:<id>`
- `QueryInterceptor` — wraps Knex; automatically scopes every query to the current tenant. **Business logic must never manually add `WHERE tenant_id = ?`.**
- `TenantContext` — AsyncLocalStorage-backed context; carries tenant ID, config, user claims through the request

### L3 Plugin System (`src/plugins/`)

- Plugin cores (`cores/`) are stateless singletons: CustomerData, CustomerCare, Analytics, Automation, Marketing
- `SandboxService` — executes plugin logic via `isolated-vm`; hard limits: 5 s timeout, 50 MB memory, 50 queries/request
- `HookRegistry` — `before` / `after` / `filter` hooks with priority ordering
- Each plugin declares `plugin.manifest.json` (dependencies, permissions, resource limits)

### L5 Async Workers (`src/workers/`)

- `AmqpModule` — `@Global()` RabbitMQ publisher/consumer (amqplib)
- BullMQ queues: `QUEUE_EMAIL`, `QUEUE_WEBHOOK`
- Bull Board UI at `/admin/queues` (dev only)
- Cron jobs via node-cron

## Frontend Architecture

**Web & Admin:** Next.js 15, React 19, TanStack Query v5, Zustand, Tailwind CSS, Module Federation (`@module-federation/nextjs-mf`)

**Mobile:** Expo 52, React Native 0.76, expo-router, NativeWind, TanStack Query v5, Zustand

Both web and admin use Vitest + Testing Library for tests.

## Architecture Overview

7-layer system:

| Layer | Name | Key Responsibilities |
|---|---|---|
| L1 | Presentation | Web (Next.js), Mobile (Expo), Admin Console, Module Federation plugins |
| L2 | API Gateway | Tenant resolution, JWT auth, rate limiting, route matching |
| L3 | Business Logic | Plugin management, stateless plugin cores, context building |
| L4 | Data Access | Query interception, connection pool management, cache, migrations |
| L5 | Infrastructure | PostgreSQL, Redis, RabbitMQ, S3/MinIO, Elasticsearch |
| L6 | Cross-Cutting | Security (AES-256-GCM, bcrypt), error handling, config, DI |
| L7 | Observability | Pino structured logging, OpenTelemetry tracing, Prometheus metrics, Sentry |

**Multi-tenancy:** Standard tenants share a PostgreSQL DB (RLS + `tenant_id`). VIP/Enterprise tenants get dedicated PostgreSQL instances. `QueryInterceptor` at L4 handles all scoping automatically.

## Architectural Reference Docs

HTML docs in `docs/` can be opened directly in a browser. Key files:

| File | Topic |
|---|---|
| `crm-request-flow.html` | Full request sequence |
| `crm-execution-context.html` | How `ExecutionContext` is built |
| `crm-data-access-layer.html` | Query interception, DIP abstractions |
| `crm-plugin-deep-dive.html` | Plugin manifest, lifecycle, sandbox |
| `crm-database-topology.html` | 3-tier DB, RLS, connection pooling |
| `crm-observability-layer.html` | Logging, tracing, metrics patterns |
