# Admin Routes Design — 2026-03-06

## Problem

The admin console frontend (`frontend/admin`, port 3000) calls backend endpoints under
`/api/v1/admin/*` that don't exist yet. All requests return 404.

## Goals

Implement all backend admin endpoints required by the admin frontend API client:

- `POST /api/v1/admin/auth/login`
- `GET/POST /api/v1/admin/tenants`
- `GET/PATCH/DELETE /api/v1/admin/tenants/:id`
- `GET /api/v1/admin/tenants/:id/plugins`
- `PATCH /api/v1/admin/tenants/:id/plugins/:pluginId`
- `GET /api/v1/admin/metrics/summary`

## Decisions

### Admin Auth — Reuse existing users table

Add a `system` tenant (subdomain: `system`) and an admin user
(`admin@crm.dev` / `admin123`) with role `super_admin` to the seed.

Admin login validates against the system tenant's users. JWT carries
`roles: ['super_admin']`, which the `SuperAdminGuard` checks on every
protected admin route.

### Middleware exclusion

Admin routes are excluded from `TenantResolverMiddleware` in `GatewayModule`
because admin operates cross-tenant and has no tenant context.

`TenantCorsMiddleware` continues to run for all routes (including admin) and
falls back to "allow all" in dev mode since no tenant is resolved.

### Data model mapping

| DB column | Frontend field | Notes |
|-----------|---------------|-------|
| `tier` | `plan` | Same values (standard/vip/enterprise) |
| `is_active = true` | `status: 'active'` | |
| `is_active = false` | `status: 'suspended'` | |
| COUNT(tenant_plugins WHERE is_enabled) | `pluginCount` | |

### Plugin list enrichment

`GET /api/v1/admin/tenants/:id/plugins` returns the 5 built-in plugin manifests
enriched with the `enabled` status from `tenant_plugins`. If a plugin has no row
in `tenant_plugins`, it is treated as disabled.

### Delete tenant — soft delete

`DELETE /api/v1/admin/tenants/:id` sets `is_active = false`.

### Metrics

Real data: `activeTenantsCount` (DB query), `dbPoolUtilization` (PoolRegistry).
Mock data: `requestsPerMinute`, `avgResponseTimeMs`, `errorRate`, `cacheHitRate`
(not available without Prometheus integration; acceptable for dev/demo).

## Module Structure

```
src/api/v1/admin/
  admin.module.ts
  guards/
    super-admin.guard.ts
  admin-auth/
    admin-auth.controller.ts
    admin-auth.service.ts
  tenants/
    admin-tenants.controller.ts
    admin-tenants.service.ts
  metrics/
    admin-metrics.controller.ts
    admin-metrics.service.ts
```

## Files Modified

- `src/gateway/gateway.module.ts` — exclude `api/v1/admin/*` from TenantResolverMiddleware
- `src/api/v1/api-v1.module.ts` — import AdminModule
- `src/db/seeds/01_tenants.ts` — add system tenant + super_admin user
