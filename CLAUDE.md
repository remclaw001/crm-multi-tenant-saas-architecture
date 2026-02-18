# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repository Is

This is a **documentation-only** architectural reference for a multi-tenant SaaS CRM system. There is no source code, build system, or test runner — only HTML documentation pages and Mermaid diagrams. To browse the docs, open `index.html` in a browser.

## Architecture Overview

The system follows a **7-layer architecture**:

| Layer | Name | Key Responsibilities |
|---|---|---|
| L1 | Presentation | Web (React), Mobile (React Native/Flutter), Plugin UI (Module Federation), Admin Console |
| L2 | API Gateway | Tenant resolution, JWT auth, rate limiting, route matching |
| L3 | Business Logic | Plugin management, stateless plugin cores, context building, shared services |
| L4 | Data Access | Query interception, connection pool management, cache manager, migration engine |
| L5 | Infrastructure | PostgreSQL, Redis, RabbitMQ, S3/MinIO, Elasticsearch |
| L6 | Cross-Cutting | Security, error handling, config management, dependency injection |
| L7 | Observability | Structured logging, distributed tracing, Prometheus metrics, audit trail |

## Multi-Tenancy Model

**Hybrid isolation strategy:**
- **Standard tenants** — shared PostgreSQL DB with `tenant_id` column + Row-Level Security (RLS); shared Redis and connection pools
- **VIP/Enterprise tenants** — dedicated PostgreSQL instances with their own connection pools (30 connections each)
- **Query Interceptor** at L4 automatically scopes all queries to the current tenant; no business logic layer code should manually filter by tenant

**Connection pools:**
- Shared pool: 200 connections (all standard tenants)
- Metadata pool: 20 connections (system operations)
- VIP pools: 30 connections per VIP tenant

**Cache key pattern:** `t:<tenant-id>:<resource-type>:<id>`

## Plugin System

Plugins are first-class citizens. Key concepts:
- Each plugin declares a `plugin.manifest.json` with dependencies, permissions, and resource limits
- Plugin Cores (CustomerData, CustomerCare, Analytics, Automation, Marketing) are stateless singletons shared across tenants
- The **Sandbox Engine** enforces hard limits: 5 s timeout, 50 MB memory, 50 queries/request
- Hook registry supports `before` / `after` / `filter` hooks with priority ordering
- Per-tenant enable/disable and canary rollout are supported at the gateway layer

## Request Lifecycle

1. **Gateway phase** — Tenant resolution → JWT verification → rate limiting → route matching
2. **Context build phase** — Load `ExecutionContext` (tenant config, plugin list, user claims) → permission check → acquire DB connection
3. **Sandbox execution** — Plugin logic runs → queries DB → updates Redis → publishes events
4. **Response & cleanup** — Return response → write audit log → release connection
5. **Async worker phase** — RabbitMQ consumers handle notifications, search indexing, webhooks

## Key Documentation Files

| File | Topic |
|---|---|
| `multi-tenant-saas-knowledge-base.html` | Foundational concepts: isolation strategies, tenant context, noisy-neighbor problem |
| `crm-database-topology.html` | 3-tier DB structure, RLS, connection pooling, read replicas |
| `crm-plugin-deep-dive.html` | Plugin manifest, lifecycle, dependency resolution, runtime execution |
| `crm-request-flow.html` | Full request sequence diagram |
| `crm-execution-context.html` | How `ExecutionContext` is built and scoped |
| `crm-data-access-layer.html` | Query interception, pool management, DIP abstractions (`ISQLDialect`, `ITenantStrategy`) |
| `crm-infrastructure-layer.html` | L5 components and dependency-inversion boundaries |
| `crm-observability-layer.html` | Logging, tracing, metrics, alerting patterns |
| `crm-query-builder.html` | Tenant-aware query builder design |

## Diagram Files

- `system_architecture.mmd` — top-level Mermaid architecture diagram
- `request-sequential-diagram.mmd` — Mermaid sequence diagram of the full request flow
- `crm_system_architecture.jpg` — rendered architecture image
