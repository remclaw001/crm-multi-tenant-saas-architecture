# CRM Multi-Tenant SaaS Architecture

Tài liệu thiết kế và codebase thực hành cho hệ thống **CRM multi-tenant SaaS** theo kiến trúc plugin-based, 7 lớp. Mục đích chính là nghiên cứu, học tập và demo các pattern kiến trúc phần mềm phức tạp trong thực tế — không phải production system.

## 📖 Web Documentation

Toàn bộ tài liệu kiến trúc được publish tại:

**[https://crm-plugin-based-system-architecture.vercel.app](https://crm-plugin-based-system-architecture.vercel.app)**

## Mục đích

- **Học tập & nghiên cứu** — Hiểu cách xây dựng hệ thống multi-tenant đúng từ nền móng: Row-Level Security, query scoping tự động, connection pool phân tầng.
- **Demo kiến trúc** — Mỗi quyết định thiết kế đều có lý do rõ ràng, được ghi lại trong tài liệu song song với code.
- **Thực hành** — Codebase chạy được, có test, có Docker Compose, có migration — đủ để fork và thí nghiệm.

## Kiến trúc tổng quan

Hệ thống theo **7-layer architecture**:

| Layer | Tên | Trách nhiệm chính |
|---|---|---|
| L1 | Presentation | Web (Next.js), Admin Console |
| L2 | API Gateway | Tenant resolution, JWT auth, rate limiting, route matching |
| L3 | Business Logic | Plugin management, stateless plugin cores, context building |
| L4 | Data Access | Query interception, connection pool, cache, migration |
| L5 | Infrastructure | PostgreSQL, Redis, RabbitMQ, S3/MinIO, Elasticsearch |
| L6 | Cross-Cutting | Security (AES-256-GCM, bcrypt), error handling, config, DI |
| L7 | Observability | Pino logging, OpenTelemetry tracing, Prometheus metrics, Sentry |

**Multi-tenancy hybrid:** Standard tenants dùng shared PostgreSQL với RLS + `tenant_id`. VIP/Enterprise tenants có dedicated PostgreSQL instance riêng. `QueryInterceptor` ở L4 tự động scope mọi query — business logic không bao giờ filter tenant thủ công.

## Cấu trúc repo

```
backend/          NestJS API (L2–L7) — TypeScript, Knex, ioredis, BullMQ
frontend/
  web/            Web app — Next.js 15, React 19, port 3002
  admin/          Admin console — Next.js 15, port 3000
docs/             Tài liệu kiến trúc HTML (nguồn của web docs)
```

## Quick Start

### Option A — Docker (toàn bộ stack)

```bash
docker compose up -d                        # build + khởi động tất cả services

docker compose exec backend npm run db:migrate   # chạy migrations (lần đầu)
docker compose exec backend npm run db:seed      # seed dữ liệu mẫu (3 tenants)
```

| Service | URL |
|---------|-----|
| Backend API | http://localhost:3001 |
| Admin Console | http://localhost:3000 |
| Web App | http://localhost:3002 |
| RabbitMQ UI | http://localhost:15672 (crm / crm) |
| MinIO Console | http://localhost:9001 (crm / crm_secret_dev) |

### Option B — Dev local (backend only)

Terminal 1:
```bash
cd backend
cp .env.example .env          # điền DATABASE_URL, REDIS_URL, RABBITMQ_URL, JWT_SECRET_FALLBACK

docker compose up -d          # khởi động infra (PostgreSQL, Redis, RabbitMQ)

npm run db:migrate            # chạy migrations
npm run db:seed               # seed dữ liệu mẫu (3 tenants)
npm run start:dev             # dev server tại http://localhost:3001

npm test                      # unit tests (vitest)

```

Terminal 2:
```bash
cd frontend/web
npm run dev                   # dev server tại http://localhost:3002


cd frontend/admin
npm run dev                   # dev server tại http://localhost:3000
```

## Tài liệu liên quan

- [Build Roadmap](https://crm-plugin-based-system-architecture.vercel.app) — thứ tự xây dựng 10 phases
- [Plugin System Deep Dive](https://crm-plugin-based-system-architecture.vercel.app) — manifest, sandbox, hook registry
- [Database Topology](https://crm-plugin-based-system-architecture.vercel.app) — 3-tier DB, RLS, connection pooling
- [Request Flow](https://crm-plugin-based-system-architecture.vercel.app) — sequence diagram toàn bộ request lifecycle
