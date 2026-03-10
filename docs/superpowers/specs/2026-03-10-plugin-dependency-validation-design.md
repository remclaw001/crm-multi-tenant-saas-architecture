# Plugin Dependency Validation — Design Spec

**Date:** 2026-03-10
**Status:** Approved

## Overview

Add dependency graph validation to the plugin system in two contexts:

1. **Bootstrap validation** — at app startup, after all built-in plugin cores have self-registered, validate the static dependency graph. Log warnings for any issues (missing deps, circular deps). Do not crash.
2. **Admin API validation** — before toggling a plugin on/off for a tenant, validate dependency constraints. Return HTTP 422 with RFC 7807 body if violated.

### Breaking change: cascade-disable replaced with error-and-reject

`AdminTenantsService.togglePlugin()` currently **cascade-disables** dependents automatically when disabling a plugin (e.g., disabling `customer-data` also disables `customer-care` and `marketing`). This spec intentionally replaces that behavior with **error-and-reject**: the caller receives a 422 listing which plugins must be disabled first, and must do so explicitly. The cascade response field `cascadeDisabled` is removed. Rationale: implicit side effects on plugin state are unpredictable for tenants; explicit is better.

## Architecture

### New: `PluginDependencyService`

Pure logic service — no I/O, no DB access. Placed in a new `src/plugins/deps/` subdirectory.

```
src/plugins/deps/plugin-dependency.service.ts
src/plugins/deps/plugin-manifests.token.ts
```

Receives manifests via injection token `PLUGIN_MANIFESTS` (provided with `BUILT_IN_MANIFESTS` array). Builds an internal `Map<string, PluginManifest>` index at construction.

**Public interface:**

```typescript
export interface GraphValidationIssue {
  type: 'missing_dependency' | 'circular_dependency';
  plugin: string;
  detail: string;
}

class PluginDependencyService {
  // Bootstrap: validates full graph. Returns issues array (empty = valid). Never throws.
  validateGraph(): GraphValidationIssue[]

  // Admin enable: returns names of declared deps not present in enabledPlugins.
  getMissingDeps(pluginName: string, enabledPlugins: string[]): string[]

  // Admin disable: returns names of enabled plugins that declare pluginName as a dependency.
  getBlockingDependents(pluginName: string, enabledPlugins: string[]): string[]
}
```

`validateGraph()` performs:
- **Missing dependency check**: for each manifest, verify every name in `dependencies` exists in the index.
- **Circular dependency check**: iterative DFS over the graph; detect back-edges.

### Injection Token

```
src/plugins/deps/plugin-manifests.token.ts
```

```typescript
export const PLUGIN_MANIFESTS = 'PLUGIN_MANIFESTS';
```

### `PluginInfraModule` changes

File: `src/plugins/plugin-infra.module.ts` (flat file — not a subdirectory).

Add to `providers` and `exports`:

```typescript
{ provide: PLUGIN_MANIFESTS, useValue: BUILT_IN_MANIFESTS },
PluginDependencyService,
```

Export `PluginDependencyService` so `AdminTenantsService` can inject it.

### Bootstrap Integration

`PluginsModule` implements `OnModuleInit`. NestJS guarantees this runs after all providers in the module tree (including all core `OnModuleInit` registrations) complete.

```typescript
@Module({ imports: [PluginInfraModule, ...cores] })
export class PluginsModule implements OnModuleInit {
  constructor(
    private readonly deps: PluginDependencyService,
    private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    const issues = this.deps.validateGraph();
    for (const issue of issues) {
      this.logger.warn(`[PluginDependency] ${issue.type}: ${issue.detail}`);
    }
  }
}
```

### New Error: `PluginDependencyError`

File: `src/common/errors/plugin-dependency.error.ts`

Extends `AppError` (statusCode 422). Carries typed fields `missingDeps` and `blockingDependents` directly on the class (not via a generic `meta` field on `AppError` — `AppError` is unchanged).

```typescript
export class PluginDependencyError extends AppError {
  constructor(
    public readonly pluginName: string,
    public readonly action: 'enable' | 'disable',
    public readonly missingDeps: string[],       // non-empty when action = 'enable'
    public readonly blockingDependents: string[], // non-empty when action = 'disable'
  ) {
    const detail = action === 'enable'
      ? `Cannot enable '${pluginName}': missing enabled dependencies: ${missingDeps.join(', ')}`
      : `Cannot disable '${pluginName}': required by enabled plugins: ${blockingDependents.join(', ')}`;
    super(422, detail, 'PLUGIN_DEPENDENCY_VIOLATION');
  }
}
```

### `HttpExceptionFilter` changes

File: `src/gateway/filters/http-exception.filter.ts`

Add an `instanceof PluginDependencyError` branch before the generic `AppError` branch. Spreads `missingDeps` / `blockingDependents` as top-level fields in the RFC 7807 response:

```typescript
if (exception instanceof PluginDependencyError) {
  status = 422;
  problemDetails = {
    ...baseDetails,
    detail: exception.message,
    code: exception.code,
    ...(exception.missingDeps.length     && { missingDeps: exception.missingDeps }),
    ...(exception.blockingDependents.length && { blockingDependents: exception.blockingDependents }),
  };
}
```

### Admin API Validation

`AdminTenantsService.togglePlugin()` injects `PluginDependencyService`. Replace the existing cascade-disable logic with validation-and-reject:

- **Enable path**: call `getMissingDeps(pluginName, enabledPlugins)`. If non-empty → throw `PluginDependencyError`.
- **Disable path**: call `getBlockingDependents(pluginName, enabledPlugins)`. If non-empty → throw `PluginDependencyError`. Remove the `toCascade` / `cascadeDisabled` response.

**Enable failure (HTTP 422):**
```json
{
  "status": 422,
  "title": "Plugin dependency violation",
  "detail": "Cannot enable 'customer-care': missing enabled dependencies: customer-data",
  "missingDeps": ["customer-data"]
}
```

**Disable failure (HTTP 422):**
```json
{
  "status": 422,
  "title": "Plugin dependency violation",
  "detail": "Cannot disable 'customer-data': required by enabled plugins: customer-care, marketing, automation",
  "blockingDependents": ["customer-care", "marketing", "automation"]
}
```

## Files Changed / Created

| File | Action |
|---|---|
| `src/plugins/deps/plugin-manifests.token.ts` | **Create** |
| `src/plugins/deps/plugin-dependency.service.ts` | **Create** |
| `src/plugins/plugin-infra.module.ts` | **Modify** (add token + service) |
| `src/plugins/plugins.module.ts` | **Modify** (add `OnModuleInit`) |
| `src/common/errors/plugin-dependency.error.ts` | **Create** |
| `src/gateway/filters/http-exception.filter.ts` | **Modify** (add `PluginDependencyError` branch) |
| `src/api/v1/admin/tenants/admin-tenants.service.ts` | **Modify** (replace cascade-disable with validation) |
| `src/plugins/deps/__tests__/plugin-dependency.service.test.ts` | **Create** |
| `src/plugins/__tests__/plugins.module.bootstrap.test.ts` | **Create** |
| `src/api/v1/admin/tenants/__tests__/admin-tenants.service.test.ts` | **Modify** (add toggle validation cases) |

## Tests

**`plugin-dependency.service.test.ts`** (unit, pure):
- `validateGraph()`: valid graph → no issues; dep name not in index → `missing_dependency` issue; A→B→A → `circular_dependency` issue
- `getMissingDeps()`: all deps enabled → `[]`; one dep not in enabledPlugins → returns that dep name
- `getBlockingDependents()`: no enabled plugin depends on target → `[]`; `customer-care` is enabled and depends on `customer-data` → returns `['customer-care']`

**`plugins.module.bootstrap.test.ts`** (unit):
- Issues found → `logger.warn()` called once per issue with `[PluginDependency]` prefix
- No issues → `logger.warn()` never called

**`admin-tenants.service.test.ts`** (unit, extend existing):
- Enable `customer-care` when `customer-data` not enabled → throws `PluginDependencyError`, `missingDeps: ['customer-data']`
- Enable `customer-care` when `customer-data` is enabled → proceeds to DB update, no error
- Disable `customer-data` when `customer-care` is enabled → throws `PluginDependencyError`, `blockingDependents` includes `customer-care`
- Disable `customer-data` when no dependent is enabled → proceeds to DB update, no error

## Constraints

- `PluginDependencyService` must have zero I/O — pure Map operations only.
- `AppError` base class is NOT modified — `PluginDependencyError` declares its own typed fields.
- Do not add `WHERE tenant_id = ?` in `AdminTenantsService` — `QueryInterceptor` handles scoping.
- The `cascadeDisabled` field is removed from the `togglePlugin` response; any existing callers/tests expecting it must be updated.
