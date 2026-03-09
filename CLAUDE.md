# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

```
backend/          NestJS API (L2–L7)
frontend/
  web/            Customer-facing app  — Next.js 15, port 3002
  admin/          Admin console        — Next.js 15, port 3000
docs/             HTML architectural reference docs
```

## Common Commands

All backend commands run from `backend/`.

```bash
# Infrastructure (required before starting the API)
docker compose up -d                          # postgres, redis, rabbitmq
docker compose --profile observability up -d  # + jaeger, prometheus, grafana, loki

# Database
npm run db:migrate           # run pending Knex migrations
npm run db:migrate:rollback      # rollback the last migration batch
npm run db:migrate:rollback:all  # rollback ALL migrations
npm run db:seed              # seed dev data
npm run db:reset             # rollback-all → migrate → seed
npm run db:status            # show migration status

# Backend
npm run start:dev           # ts-node dev server (port from PORT env, default 3000)
npm run build               # tsc compile to dist/
npm run start               # run compiled dist/main.js (after build)

# Tests (backend)
npm test                                       # vitest run (unit tests only, no integration)
npm run test:watch                             # vitest watch mode
npm run test:ui                                # vitest UI
npx vitest src/path/to/file.test.ts            # run a single test file
npx vitest -t "test name" src/path/to/file.ts # run a single test case by name

# Frontend (run from the respective directory)
npm run dev    # web → :3002, admin → :3000
npm run build
npm test       # vitest
```

Test files must live inside `src/**/__tests__/` directories — vitest only picks up `src/**/__tests__/**/*.{test,spec}.ts`. Integration tests (`src/**/__tests__/integration/`) are excluded from the default test run and require live DB/Redis.

Unit tests require `OTEL_DISABLED=true` in the test environment (already set in `vitest.config.ts`) to prevent OpenTelemetry overhead.

**Vitest mock gotcha:** Variables referenced inside `vi.mock()` factory functions must be declared with `vi.hoisted()` — otherwise the mock fails with "cannot access before initialization".

## Environment

Copy `.env.example` to `.env` in `backend/`. Variables are validated at startup via Zod in `src/config/env.ts`.

**Required:**

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Shared PostgreSQL pool (max 200 connections) |
| `REDIS_URL` | ioredis |
| `RABBITMQ_URL` | amqplib |
| `JWT_JWKS_URI` **or** `JWT_SECRET_FALLBACK` | One is required; use `JWT_SECRET_FALLBACK` (min 32 chars) in dev |

**Key optional (affect significant behavior):**

| Variable | Default | Notes |
|---|---|---|
| `ENCRYPTION_KEY` | Dev insecure key | 64 hex chars (32 bytes AES-256-GCM); override in production |
| `DATABASE_METADATA_URL` | Same as `DATABASE_URL` | Secondary pool for migrations & tenant lookup (max 20) |
| `CORS_ORIGINS` | Allow all | Comma-separated global fallback; per-tenant origins take precedence |
| `SENTRY_DSN` | Disabled | Error tracking; no-op when unset |
| `ELASTICSEARCH_URL` | Disabled | Search indexing gracefully degraded when unset |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | Dev log mode | Emails logged to console when unset |
| `EMAIL_FROM` | `noreply@crm.dev` | Sender address |
| `LOG_LEVEL` | `info` | Pino log level |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Disabled | Jaeger/collector gRPC endpoint |
| `OTEL_DISABLED` | `false` | Set `true` in unit tests |
| `OTEL_SERVICE_NAME` | `crm-api` | Service name on spans and log entries |
| `PORT` | `3000` | HTTP server port |
| `THROTTLE_LIMIT` / `THROTTLE_TTL_MS` | `100` / `60000` | Global rate limit (requests per TTL window in ms) |

## Database Migrations

5 migrations in `backend/src/db/migrations/` (run in order):

| Migration | Tables Added |
|-----------|-------------|
| `20260222000001_init_schema` | tenants, users, roles, user_roles, permissions (RLS on users/roles/user_roles) |
| `20260226000002_tenant_plugins` | tenant_plugins (no RLS) |
| `20260228000003_audit_logs` | audit_logs (no RLS) |
| `20260303000004_plugin_tables` | customers, support_cases, automation_triggers, marketing_campaigns (all RLS + FORCE ROW LEVEL SECURITY) |
| `20260309000005_refresh_tokens` | refresh_tokens — stores SHA-256 hash of opaque token (no RLS; FK → users + tenants) |
| `20260309000006_tenant_status_and_tier` | Adds `status` column to tenants; makes `subdomain` nullable (released on offboard); drops deprecated `standard` tier |
| `20260309000007_tenant_lifecycle` | Adds `offboarded_at TIMESTAMPTZ` to tenants; adds `vip_db_registry` table |
| `20260309000008_tenant_admins` | Adds `tenant_admins` table (tenant_id, email, role) — stores admin contact recorded during provisioning |

## Backend Architecture

**Framework:** NestJS 10 + TypeScript 5 + Knex (SQL) + ioredis + amqplib + BullMQ

**Module load order** (defined in `src/app.module.ts`, order is mandatory):
1. `DalModule` — `@Global()`: exports `PoolRegistry`, `CacheManager`, `KNEX_INSTANCE`, `REDIS_CLIENT`
2. `ObservabilityModule` — Pino logger + OpenTelemetry + Prometheus
3. `SecurityModule` — `@Global()`: `EncryptionService` (AES-256-GCM), `PasswordService` (bcrypt)
4. `WorkersModule` — RabbitMQ (amqplib), BullMQ queues, node-cron
5. `GatewayModule` — middleware pipeline, JWT guard, CORS
6. `HealthModule` — `/health` endpoint
7. `ApiModule` — REST routes under `src/api/v1/` + `PluginsModule`

**Bootstrap import order** (`src/main.ts`) is critical:
1. `tracing.setup` (OpenTelemetry must patch before NestJS loads modules)
2. `sentry.setup`
3. `reflect-metadata`
4. NestJS factories

### L2 Gateway (`src/gateway/`)

Middleware pipeline (applied in order):
- `CorrelationIdMiddleware` — injects `X-Correlation-ID`
- `TenantResolverMiddleware` — resolves tenant from subdomain/header, stores in `TenantContext`
- `TenantCorsMiddleware` — per-tenant CORS (do **not** call `app.enableCors()`)
- `JwtAuthGuard` — validates JWT via JWKS or fallback secret

**Tenant resolution priority:** `X-Tenant-ID` header → `X-Tenant-Slug` header → Host subdomain (`acme.app.com` → `acme`).

**Decorators** (both in `src/gateway/decorators/current-tenant.decorator.ts`):
- `@CurrentTenant()` — extracts `ResolvedTenant` set by `TenantResolverMiddleware`
- `@CurrentUser()` — extracts `JwtClaims` set by `JwtAuthGuard`
- `@Public()` — bypasses `JwtAuthGuard` (in `public.decorator.ts`)

### L4 Data Access (`src/dal/`)

- `PoolRegistry` — manages shared (200), metadata (20), and VIP (30 each) connection pools
- `CacheManager` — ioredis wrapper; all keys follow `t:<tenant-id>:<resource-type>:<id>`
- `QueryInterceptor` — wraps Knex; automatically scopes every query to the current tenant. **Business logic must never manually add `WHERE tenant_id = ?`.**
- `TenantContext` — AsyncLocalStorage-backed context; carries tenant ID, tier, and per-request query count. Use `TenantContext.requireTenantId()` in business logic (throws if called outside a request context); `getTenantId()` returns `undefined` when called outside.
- `REDIS_CLIENT` — raw ioredis instance injected as `@Inject('REDIS_CLIENT')`; use this (not `CacheManager`) in auth flows that run outside `TenantContext` (e.g. `JwtAuthGuard`, `AuthService`).

### L3 Plugin System (`src/plugins/`)

- Plugin cores (`cores/`) are stateless singletons with real DB-backed implementations:
  - `customer-data` — CRUD on `customers` table
  - `customer-care` — CRUD on `support_cases` (FK → customers); registers `after:customer.create` hook
  - `analytics` — aggregate reports (`summary`, `trends`) from `customers` + `support_cases`
  - `automation` — CRUD on `automation_triggers`
  - `marketing` — CRUD on `marketing_campaigns`
- `SandboxService` — executes plugin logic via timeout-race (`Promise.race`); hard limits: 5 s timeout, 50 queries/request
- `HookRegistry` — `before` / `after` / `filter` hooks with priority ordering. Hook keys use `"<type>:<event>"` format (e.g. `before:customer.create`, `after:customer.create`). Register in `OnModuleInit`; fire via `hookRegistry.emit(type, event, ctx, data)`.
- Each plugin declares a manifest via `built-in-manifests.ts` (dependencies, permissions, resource limits). Plugin dependency graph: `customer-care` → `customer-data`; `automation` → `customer-data` + `analytics`; `marketing` → `customer-data`. A plugin cannot be enabled unless its dependencies are enabled first.
- **`PluginInfraModule` must be first** in `PluginsModule.imports` — makes `PluginRegistryService`, `ExecutionContextBuilder`, `HookRegistryService`, `SandboxService` available as globals before core modules initialize

**Standard plugin controller pattern** (see `customer-data.controller.ts` for reference):
```typescript
const ctx = await this.contextBuilder.build(tenant, user, req.correlationId ?? 'n/a');
if (!ctx.enabledPlugins.includes(PLUGIN_NAME)) throw new ForbiddenException(…);
const result = await this.sandbox.execute(() => this.core.method(ctx), this.core.manifest.limits.timeoutMs);
```

**Plugin REST routes (all under `/api/v1/plugins/`):**

| Plugin | Routes |
|--------|--------|
| (infra) | GET `/` — returns `{ enabledPlugins: string[] }` for current tenant |
| customer-data | GET/POST `/customers`, GET/PUT/DELETE `/customers/:id` |
| customer-care | GET/POST `/cases`, GET/PUT/DELETE `/cases/:id` |
| analytics | GET `/reports/:type` (`summary` \| `trends`) |
| automation | GET/POST `/triggers`, GET/PUT/DELETE `/triggers/:id` |
| marketing | GET/POST `/campaigns`, GET/PUT/DELETE `/campaigns/:id` |

**Smoke test endpoint:** `GET /api/v1/:plugin/ping` — verifies the full middleware chain (tenant resolved, JWT valid, `TenantContext` set). Returns tenant, user, and context info. Useful during development.

**Auth endpoints (all under `/auth/`):**

| Endpoint | Auth | Description |
|----------|------|-------------|
| `POST /auth/login` | `@Public()` | Returns `{ token, refreshToken, user, tenant }`. Issues JWT with `jti` claim. |
| `POST /auth/refresh` | `@Public()` | Body: `{ refreshToken: string (96 hex chars) }`. Rotates refresh token. |
| `POST /auth/logout` | JWT required | Blacklists the `jti` in Redis with TTL = remaining token lifetime. Returns 204. |

**Tenant lifecycle** — `tenants.status` column, controlled by `AdminTenantsService`:
- States: `provisioning` → `active` → `migrating` / `grace_period` / `suspended` / `offboarding` → `offboarded`
- On create: status starts as `provisioning`, transitions to `active` after setup completes
- On offboard: status → `offboarding` (locks tenant), then `offboarded` + `subdomain` set to `NULL`
- Valid tiers: `basic`, `premium`, `enterprise`, `vip` (`standard` was removed)

**JTI blacklist:** `JwtAuthGuard.handleRequest` is `async`. It checks `auth:blacklist:<jti>` in Redis for every authenticated request. Tokens without a `jti` claim still pass (backwards-compatible). Blacklist key TTL = remaining lifetime of the JWT.

### L5 Async Workers (`src/workers/`)

- `AmqpModule` — `@Global()` RabbitMQ publisher/consumer (amqplib); 4 exchanges with DLX: audit, notifications, search.index, webhooks
- `AmqpPublisher` — `publishAudit/Notification/SearchIndex/Webhook` with persistent delivery
- BullMQ queues: `QUEUE_EMAIL` (5 retries, exponential backoff) + `QUEUE_WEBHOOK` (7 retries, HMAC-SHA256 delivery)
- Bull Board UI at `/admin/queues` (dev only)
- Cron jobs via node-cron: session cleanup (2 AM daily), queue depth check (every 5 min)

### L6 Cross-Cutting (`src/common/`)

- `SecurityModule` (`@Global`) — `EncryptionService` (AES-256-GCM, format: `base64(iv):base64(authTag):base64(ciphertext)`), `PasswordService` (bcrypt cost 12)
- Error hierarchy: `AppError` (base, statusCode+code) → `DomainError` (4xx), `PluginError` (5xx), `ValidationError` (400) in `src/common/errors/`
- Specific errors include: `TenantNotFoundError`, `PluginDisabledError`, `PermissionDeniedError`, `ResourceNotFoundError`, `ConflictError`, `PluginTimeoutError`, `PluginQueryLimitError`
- `HttpExceptionFilter` maps `AppError` → RFC 7807 Problem Details JSON; reports 5xx to Sentry

## Frontend Architecture

**Web & Admin:** Next.js 15, React 19, TanStack Query v5, Zustand, Tailwind CSS, Module Federation (`@module-federation/nextjs-mf`)

Both web and admin use Vitest + Testing Library for tests.

**Frontend env var:** Both web and admin API clients read `NEXT_PUBLIC_API_URL` (default `http://localhost:8080`). Since the backend runs on port 3000 by default, set `NEXT_PUBLIC_API_URL=http://localhost:3000` in each app's `.env.local`.

**Web route groups** (`frontend/web/src/app/`):
- `(crm)/` — contacts, cases, analytics, automation, marketing (authenticated CRM views)

**Admin route groups** (`frontend/admin/src/app/`):
- `(dashboard)/` — tenants, tenants/[id] (detail), tenants/[id]/plugins (plugin toggle), metrics (admin console)

**Auth state** (`src/stores/auth.store.ts`): Zustand `useAuthStore` persisted to `localStorage` under key `crm-web-auth`. Holds `token`, `tenantId`, `tenantName`, `userName`, `userEmail`. Call `setAuth(...)` on login, `logout()` to clear.

**API client pattern** (`src/lib/api-client.ts` in each app): every request sends `Authorization: Bearer <token>` and `X-Tenant-ID: <tenantId>` headers. Errors are typed as `ApiError` (wraps RFC 7807 body). TanStack Query retry is disabled for 4xx responses.

**`PluginGate` component** (`src/components/plugin-gate.tsx`, web only): wraps any feature area that requires a plugin. Calls `GET /api/v1/plugins/` to fetch `enabledPlugins` and renders a "not enabled" message if the plugin is absent. Use this instead of inline plugin checks in page components.

## Architecture Overview

7-layer system:

| Layer | Name | Key Responsibilities |
|---|---|---|
| L1 | Presentation | Web (Next.js), Admin Console, Module Federation plugins |
| L2 | API Gateway | Tenant resolution, JWT auth, rate limiting, route matching |
| L3 | Business Logic | Plugin management, stateless plugin cores, context building |
| L4 | Data Access | Query interception, connection pool management, cache, migrations |
| L5 | Infrastructure | PostgreSQL, Redis, RabbitMQ, S3/MinIO, Elasticsearch |
| L6 | Cross-Cutting | Security (AES-256-GCM, bcrypt), error handling, config, DI |
| L7 | Observability | Pino structured logging, OpenTelemetry tracing, Prometheus metrics, Sentry |

**Multi-tenancy:** Standard tenants share a PostgreSQL DB (RLS + `tenant_id`). VIP/Enterprise tenants get dedicated PostgreSQL instances. `QueryInterceptor` at L4 handles all scoping automatically.

## Critical Constraints

These rules are enforced by framework infrastructure — violating them causes silent data corruption or auth bypass:

1. **Never add `WHERE tenant_id = ?` in business logic.** `QueryInterceptor` scopes every Knex query automatically. Duplicate filtering will break cross-tenant admin operations.
2. **Never call `app.enableCors()`.** `TenantCorsMiddleware` handles per-tenant CORS. Global CORS would override tenant-specific policies.
3. **Module and bootstrap import order is not negotiable.** OpenTelemetry must monkey-patch before any NestJS module loads (see `src/main.ts`). `DalModule` must be first in `app.module.ts` because subsequent modules inject `KNEX_INSTANCE` and `PoolRegistry`.
4. **`PluginInfraModule` must be first in `PluginsModule.imports`.** Core modules call `registry.register(this)` in `OnModuleInit` — the registry must exist before that.

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
| `crm-auth-flow.html` | JWT, JWKS, tenant cross-validation |
| `crm-gateway-layer.html` | Middleware pipeline detail |
| `crm-crosscutting-layer.html` | Security module, error hierarchy |
| `crm-infrastructure-layer.html` | RabbitMQ, BullMQ, cron topology |
| `crm-build-roadmap.html` | Phase-by-phase implementation plan |
