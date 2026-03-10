# Plugin Dependency Validation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `PluginDependencyService` for static graph validation at bootstrap (log warnings) and HTTP 422 validation at admin plugin toggle (replace cascade-disable with error-and-reject).

**Architecture:** New pure `PluginDependencyService` in `src/plugins/deps/` receives manifests via `PLUGIN_MANIFESTS` injection token. `PluginsModule.onModuleInit()` calls `validateGraph()` after all cores register. `AdminTenantsService.togglePlugin()` replaces inline dep logic + cascade with service calls + `PluginDependencyError`.

**Tech Stack:** NestJS 10, TypeScript 5, Vitest (globals: true, `vi.hoisted()` for mock vars)

**Spec:** `docs/superpowers/specs/2026-03-10-plugin-dependency-validation-design.md`

---

## Chunk 1: PluginDependencyService

### Task 1: Create injection token + write failing tests

**Files:**
- Create: `backend/src/plugins/deps/plugin-manifests.token.ts`
- Create: `backend/src/plugins/deps/__tests__/plugin-dependency.service.test.ts`

- [ ] **Step 1: Create the injection token**

```typescript
// backend/src/plugins/deps/plugin-manifests.token.ts
export const PLUGIN_MANIFESTS = 'PLUGIN_MANIFESTS';
```

- [ ] **Step 2: Write the failing tests**

```typescript
// backend/src/plugins/deps/__tests__/plugin-dependency.service.test.ts
import { PluginDependencyService } from '../plugin-dependency.service';
import { PluginManifest } from '../../interfaces/plugin-manifest.interface';

const makeManifest = (name: string, deps: string[] = []): PluginManifest => ({
  name,
  version: '1.0.0',
  description: '',
  dependencies: deps,
  permissions: [],
  limits: { timeoutMs: 5000, memoryMb: 50, maxQueries: 50 },
  hooks: [],
});

const make = (manifests: PluginManifest[]) => new PluginDependencyService(manifests);

describe('PluginDependencyService', () => {
  describe('validateGraph()', () => {
    it('returns no issues for a valid graph', () => {
      const svc = make([
        makeManifest('a'),
        makeManifest('b', ['a']),
        makeManifest('c', ['a', 'b']),
      ]);
      expect(svc.validateGraph()).toEqual([]);
    });

    it('returns missing_dependency issue when dep is not registered', () => {
      const svc = make([makeManifest('a', ['nonexistent'])]);
      const issues = svc.validateGraph();
      expect(issues).toHaveLength(1);
      expect(issues[0].type).toBe('missing_dependency');
      expect(issues[0].plugin).toBe('a');
      expect(issues[0].detail).toContain('nonexistent');
    });

    it('returns circular_dependency issue for A→B→A', () => {
      const svc = make([
        makeManifest('a', ['b']),
        makeManifest('b', ['a']),
      ]);
      const issues = svc.validateGraph();
      const circular = issues.filter((i) => i.type === 'circular_dependency');
      expect(circular.length).toBeGreaterThan(0);
    });

    it('returns circular_dependency for self-reference A→A', () => {
      const svc = make([makeManifest('a', ['a'])]);
      const issues = svc.validateGraph();
      const circular = issues.filter((i) => i.type === 'circular_dependency');
      expect(circular.length).toBeGreaterThan(0);
    });

    it('returns no issues for built-in manifests (sanity check)', () => {
      const { BUILT_IN_MANIFESTS } = require('../../manifest/built-in-manifests');
      const svc = make(BUILT_IN_MANIFESTS);
      expect(svc.validateGraph()).toEqual([]);
    });
  });

  describe('getMissingDeps()', () => {
    it('returns empty array when all deps are enabled', () => {
      const svc = make([makeManifest('care', ['data']), makeManifest('data')]);
      expect(svc.getMissingDeps('care', ['data'])).toEqual([]);
    });

    it('returns missing dep names when some deps are not enabled', () => {
      const svc = make([makeManifest('care', ['data'])]);
      expect(svc.getMissingDeps('care', [])).toEqual(['data']);
    });

    it('returns empty array for unknown plugin name', () => {
      const svc = make([makeManifest('data')]);
      expect(svc.getMissingDeps('unknown', [])).toEqual([]);
    });

    it('returns empty array for a plugin with no dependencies', () => {
      const svc = make([makeManifest('data')]);
      expect(svc.getMissingDeps('data', [])).toEqual([]);
    });
  });

  describe('getBlockingDependents()', () => {
    it('returns empty array when no enabled plugin depends on target', () => {
      const svc = make([makeManifest('care', ['data']), makeManifest('data')]);
      expect(svc.getBlockingDependents('data', [])).toEqual([]);
    });

    it('returns enabled dependents when they depend on target', () => {
      const svc = make([makeManifest('care', ['data']), makeManifest('data')]);
      const blocking = svc.getBlockingDependents('data', ['care']);
      expect(blocking).toEqual(['care']);
    });

    it('returns only ENABLED dependents, not disabled ones', () => {
      const svc = make([
        makeManifest('care', ['data']),
        makeManifest('marketing', ['data']),
        makeManifest('data'),
      ]);
      // marketing is enabled, care is not
      const blocking = svc.getBlockingDependents('data', ['marketing']);
      expect(blocking).toEqual(['marketing']);
    });

    it('returns multiple enabled dependents', () => {
      const svc = make([
        makeManifest('care', ['data']),
        makeManifest('marketing', ['data']),
        makeManifest('automation', ['data', 'analytics']),
        makeManifest('data'),
        makeManifest('analytics'),
      ]);
      const blocking = svc.getBlockingDependents('data', ['care', 'marketing', 'automation']);
      expect(blocking).toContain('care');
      expect(blocking).toContain('marketing');
      expect(blocking).toContain('automation');
      expect(blocking).toHaveLength(3);
    });

    it('returns empty array for unknown plugin name', () => {
      const svc = make([makeManifest('data')]);
      expect(svc.getBlockingDependents('unknown', ['data'])).toEqual([]);
    });
  });
});
```

- [ ] **Step 3: Run tests — confirm they all FAIL**

```bash
cd backend
npx vitest src/plugins/deps/__tests__/plugin-dependency.service.test.ts
```

Expected: all tests fail with `Cannot find module '../plugin-dependency.service'`

### Task 2: Implement PluginDependencyService

**Files:**
- Create: `backend/src/plugins/deps/plugin-dependency.service.ts`

- [ ] **Step 1: Implement the service**

```typescript
// backend/src/plugins/deps/plugin-dependency.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { PluginManifest } from '../interfaces/plugin-manifest.interface';
import { PLUGIN_MANIFESTS } from './plugin-manifests.token';

export interface GraphValidationIssue {
  type: 'missing_dependency' | 'circular_dependency';
  plugin: string;
  detail: string;
}

@Injectable()
export class PluginDependencyService {
  private readonly index: Map<string, PluginManifest>;

  constructor(@Inject(PLUGIN_MANIFESTS) manifests: PluginManifest[]) {
    this.index = new Map(manifests.map((m) => [m.name, m]));
  }

  validateGraph(): GraphValidationIssue[] {
    const issues: GraphValidationIssue[] = [];

    // Pass 1: missing dependency check
    for (const [name, manifest] of this.index) {
      for (const dep of manifest.dependencies) {
        if (!this.index.has(dep)) {
          issues.push({
            type: 'missing_dependency',
            plugin: name,
            detail: `Plugin '${name}' depends on '${dep}' which is not registered`,
          });
        }
      }
    }

    // Pass 2: circular dependency detection (DFS with color marking)
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>(
      [...this.index.keys()].map((k) => [k, WHITE]),
    );

    const dfs = (node: string, path: string[]): void => {
      color.set(node, GRAY);
      const manifest = this.index.get(node);
      if (!manifest) return;

      for (const dep of manifest.dependencies) {
        if (!this.index.has(dep)) continue; // already caught in pass 1
        if (color.get(dep) === GRAY) {
          const cycleStart = path.indexOf(dep);
          const cycle = [...path.slice(cycleStart), node, dep].join(' → ');
          issues.push({
            type: 'circular_dependency',
            plugin: node,
            detail: `Circular dependency detected: ${cycle}`,
          });
        } else if (color.get(dep) === WHITE) {
          dfs(dep, [...path, node]);
        }
      }
      color.set(node, BLACK);
    };

    for (const name of this.index.keys()) {
      if (color.get(name) === WHITE) {
        dfs(name, []);
      }
    }

    return issues;
  }

  getMissingDeps(pluginName: string, enabledPlugins: string[]): string[] {
    const manifest = this.index.get(pluginName);
    if (!manifest) return [];
    return manifest.dependencies.filter((dep) => !enabledPlugins.includes(dep));
  }

  getBlockingDependents(pluginName: string, enabledPlugins: string[]): string[] {
    return [...this.index.values()]
      .filter((m) => m.dependencies.includes(pluginName) && enabledPlugins.includes(m.name))
      .map((m) => m.name);
  }
}
```

- [ ] **Step 2: Run tests — confirm they all PASS**

```bash
cd backend
npx vitest src/plugins/deps/__tests__/plugin-dependency.service.test.ts
```

Expected: all 13 tests pass

- [ ] **Step 3: Commit**

```bash
cd backend
git add src/plugins/deps/plugin-manifests.token.ts \
        src/plugins/deps/plugin-dependency.service.ts \
        src/plugins/deps/__tests__/plugin-dependency.service.test.ts
git commit -m "feat(plugins): add PluginDependencyService with graph validation"
```

---

## Chunk 2: PluginDependencyError + HttpExceptionFilter

### Task 3: Create PluginDependencyError

**Files:**
- Create: `backend/src/common/errors/plugin-dependency.error.ts`
- Modify: `backend/src/common/errors/index.ts`

- [ ] **Step 1: Create the error class**

```typescript
// backend/src/common/errors/plugin-dependency.error.ts
import { AppError } from './app.error';

export class PluginDependencyError extends AppError {
  constructor(
    public readonly pluginName: string,
    public readonly action: 'enable' | 'disable',
    public readonly missingDeps: string[],
    public readonly blockingDependents: string[],
  ) {
    const detail =
      action === 'enable'
        ? `Cannot enable '${pluginName}': missing enabled dependencies: ${missingDeps.join(', ')}`
        : `Cannot disable '${pluginName}': required by enabled plugins: ${blockingDependents.join(', ')}`;
    super(422, detail, 'PLUGIN_DEPENDENCY_VIOLATION');
  }
}
```

- [ ] **Step 2: Export from the errors barrel**

Open `backend/src/common/errors/index.ts` and add this line at the end:

```typescript
export { PluginDependencyError } from './plugin-dependency.error';
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd backend
npx tsc --noEmit
```

Expected: no errors

### Task 4: Update HttpExceptionFilter to include extra fields

**Files:**
- Modify: `backend/src/gateway/filters/http-exception.filter.ts`

- [ ] **Step 1: Add import for PluginDependencyError**

At the top of `http-exception.filter.ts`, after the existing `AppError` import, add:

```typescript
import { PluginDependencyError } from '../../common/errors/plugin-dependency.error';
```

- [ ] **Step 2: Add PluginDependencyError branch inside the AppError block**

The filter's AppError block currently looks like:

```typescript
    if (exception instanceof AppError) {
      status = exception.statusCode;
      detail = exception.message;
      code   = exception.code;
    }
```

Replace it with:

```typescript
    if (exception instanceof AppError) {
      status = exception.statusCode;
      detail = exception.message;
      code   = exception.code;
    }
```

Then, immediately after the `if (code !== undefined) { problemDetails['code'] = code; }` block, add:

```typescript
    // PluginDependencyError: include missingDeps / blockingDependents in RFC 7807 body
    if (exception instanceof PluginDependencyError) {
      if (exception.missingDeps.length > 0) {
        problemDetails['missingDeps'] = exception.missingDeps;
      }
      if (exception.blockingDependents.length > 0) {
        problemDetails['blockingDependents'] = exception.blockingDependents;
      }
    }
```

This works because `PluginDependencyError extends AppError` — the base AppError branch sets `status`, `detail`, `code`, and then this block adds the extra fields to `problemDetails` before it's sent. No duplication of base logic needed.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd backend
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
cd backend
git add src/common/errors/plugin-dependency.error.ts \
        src/common/errors/index.ts \
        src/gateway/filters/http-exception.filter.ts
git commit -m "feat(errors): add PluginDependencyError (422) with RFC 7807 extra fields"
```

---

## Chunk 3: Bootstrap + Admin API Integration

### Task 5: Register PluginDependencyService in PluginInfraModule

**Files:**
- Modify: `backend/src/plugins/plugin-infra.module.ts`

- [ ] **Step 1: Add imports and update providers/exports**

Open `backend/src/plugins/plugin-infra.module.ts`. Add these imports at the top:

```typescript
import { PLUGIN_MANIFESTS } from './deps/plugin-manifests.token';
import { PluginDependencyService } from './deps/plugin-dependency.service';
import { BUILT_IN_MANIFESTS } from './manifest/built-in-manifests';
```

Then in the `@Module` decorator, add to both `providers` and `exports`:

```typescript
{ provide: PLUGIN_MANIFESTS, useValue: BUILT_IN_MANIFESTS },
PluginDependencyService,
```

The final `@Module` decorator should look like:

```typescript
@Global()
@Module({
  imports: [ObservabilityModule],
  providers: [
    { provide: PLUGIN_MANIFESTS, useValue: BUILT_IN_MANIFESTS },
    PluginDependencyService,
    PluginRegistryService,
    ExecutionContextBuilder,
    HookRegistryService,
    SandboxService,
    IsolatedSandboxService,
  ],
  exports: [
    PluginDependencyService,
    PluginRegistryService,
    ExecutionContextBuilder,
    HookRegistryService,
    SandboxService,
    IsolatedSandboxService,
  ],
})
export class PluginInfraModule {}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd backend
npx tsc --noEmit
```

Expected: no errors

### Task 6: Add OnModuleInit to PluginsModule + bootstrap test

**Files:**
- Modify: `backend/src/plugins/plugins.module.ts`
- Create: `backend/src/plugins/__tests__/plugins.module.bootstrap.test.ts`

- [ ] **Step 1: Write the failing bootstrap test**

```typescript
// backend/src/plugins/__tests__/plugins.module.bootstrap.test.ts
import { PluginsModule } from '../plugins.module';
import { PluginDependencyService, GraphValidationIssue } from '../deps/plugin-dependency.service';

describe('PluginsModule.onModuleInit()', () => {
  let module: PluginsModule;
  let mockValidateGraph: ReturnType<typeof vi.fn>;
  let mockWarn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockValidateGraph = vi.fn();
    mockWarn = vi.fn();

    const mockDeps = { validateGraph: mockValidateGraph } as unknown as PluginDependencyService;
    module = new PluginsModule(mockDeps);

    // Spy on the NestJS Logger instance created inside the module
    vi.spyOn((module as any).logger, 'warn').mockImplementation(mockWarn);
  });

  it('logs a warning for each validation issue', () => {
    const issues: GraphValidationIssue[] = [
      { type: 'missing_dependency', plugin: 'a', detail: 'Plugin a depends on missing' },
      { type: 'circular_dependency', plugin: 'b', detail: 'Circular: b → b' },
    ];
    mockValidateGraph.mockReturnValue(issues);

    module.onModuleInit();

    expect(mockWarn).toHaveBeenCalledTimes(2);
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('[PluginDependency]'));
  });

  it('logs nothing when graph is valid', () => {
    mockValidateGraph.mockReturnValue([]);

    module.onModuleInit();

    expect(mockWarn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test — confirm it FAILs**

```bash
cd backend
npx vitest src/plugins/__tests__/plugins.module.bootstrap.test.ts
```

Expected: fails — `PluginsModule` constructor does not accept these args yet

- [ ] **Step 3: Update PluginsModule**

Replace the content of `backend/src/plugins/plugins.module.ts` with:

```typescript
import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { PluginInfraModule } from './plugin-infra.module';
import { CustomerDataModule } from './cores/customer-data/customer-data.module';
import { CustomerCareModule } from './cores/customer-care/customer-care.module';
import { AnalyticsModule } from './cores/analytics/analytics.module';
import { AutomationModule } from './cores/automation/automation.module';
import { MarketingModule } from './cores/marketing/marketing.module';
import { PluginsListController } from './plugins-list.controller';
import { PluginDependencyService } from './deps/plugin-dependency.service';

@Module({
  imports: [
    // PluginInfraModule FIRST — populates global container before cores are instantiated
    PluginInfraModule,
    CustomerDataModule,
    CustomerCareModule,
    AnalyticsModule,
    AutomationModule,
    MarketingModule,
  ],
  controllers: [PluginsListController],
})
export class PluginsModule implements OnModuleInit {
  private readonly logger = new Logger(PluginsModule.name);

  constructor(private readonly deps: PluginDependencyService) {}

  onModuleInit(): void {
    const issues = this.deps.validateGraph();
    for (const issue of issues) {
      this.logger.warn(`[PluginDependency] ${issue.type}: ${issue.detail}`);
    }
  }
}
```

- [ ] **Step 4: Run test — confirm it PASSES**

```bash
cd backend
npx vitest src/plugins/__tests__/plugins.module.bootstrap.test.ts
```

Expected: 2 tests pass

- [ ] **Step 5: Run full test suite to confirm no regressions**

```bash
cd backend
npm test
```

Expected: all tests pass (393+ passing)

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/plugins/plugin-infra.module.ts \
        src/plugins/plugins.module.ts \
        src/plugins/__tests__/plugins.module.bootstrap.test.ts
git commit -m "feat(plugins): bootstrap graph validation via PluginsModule.onModuleInit"
```

### Task 7: Update AdminTenantsService — replace cascade-disable with error-and-reject

**Files:**
- Modify: `backend/src/api/v1/admin/tenants/admin-tenants.service.ts`
- Modify: `backend/src/api/v1/admin/tenants/__tests__/admin-tenants.service.test.ts`

- [ ] **Step 1: Add mock declarations for PluginDependencyService**

At the top of `backend/src/api/v1/admin/tenants/__tests__/admin-tenants.service.test.ts`, after the last existing `vi.hoisted()` declaration (currently `mockQuotaUpdateCap`), add:

```typescript
const mockGetMissingDeps       = vi.hoisted(() => vi.fn().mockReturnValue([]));
const mockGetBlockingDependents = vi.hoisted(() => vi.fn().mockReturnValue([]));
```

After the last `vi.mock()` block (the `TenantQuotaEnforcer` mock), add:

```typescript
vi.mock('../../../../plugins/deps/plugin-dependency.service', () => ({
  PluginDependencyService: vi.fn().mockImplementation(() => ({
    getMissingDeps: mockGetMissingDeps,
    getBlockingDependents: mockGetBlockingDependents,
  })),
}));
```

After the existing imports block (after `import { AmqpPublisher } ...`), add:

```typescript
import { PluginDependencyService } from '../../../../plugins/deps/plugin-dependency.service';
import { PluginDependencyError } from '../../../../common/errors/plugin-dependency.error';
```

In the main `beforeEach` `service = new AdminTenantsService(...)` call, add `new (PluginDependencyService as any)()` as the **8th argument** (after `mockDataExportQueue`):

```typescript
    service = new AdminTenantsService(
      new (PoolRegistry as any)(),
      new (CacheManager as any)(),
      new (AmqpPublisher as any)(),
      mockRedis,
      mockVipMigrationQueue,
      mockVipDecommissionQueue,
      mockDataExportQueue,
      new (PluginDependencyService as any)(),  // ← add this
    );
```

- [ ] **Step 2: Write the failing togglePlugin tests**

Add a new `describe('togglePlugin()')` block at the bottom of the main `describe('AdminTenantsService', ...)` block:

```typescript
  describe('togglePlugin()', () => {
    const tenantId = 'tenant-uuid';

    describe('enable path', () => {
      it('enables plugin when all dependencies are satisfied', async () => {
        mockGetMissingDeps.mockReturnValue([]);
        mockQuery
          .mockResolvedValueOnce({ rows: [{ plugin_name: 'customer-data', is_enabled: true }] })
          .mockResolvedValueOnce({ rows: [] }); // INSERT

        const result = await service.togglePlugin(tenantId, 'customer-care', true);
        expect(result).toEqual({ pluginId: 'customer-care', enabled: true });
      });

      it('throws PluginDependencyError (422) when a dependency is not enabled', async () => {
        mockGetMissingDeps.mockReturnValue(['customer-data']);
        mockQuery.mockResolvedValueOnce({ rows: [] });

        await expect(service.togglePlugin(tenantId, 'customer-care', true))
          .rejects.toMatchObject({
            statusCode: 422,
            code: 'PLUGIN_DEPENDENCY_VIOLATION',
            missingDeps: ['customer-data'],
          });
      });
    });

    describe('disable path', () => {
      it('disables plugin when no enabled plugin depends on it', async () => {
        mockGetBlockingDependents.mockReturnValue([]);
        mockQuery
          .mockResolvedValueOnce({ rows: [{ plugin_name: 'analytics', is_enabled: true }] })
          .mockResolvedValueOnce({ rows: [] }); // INSERT

        const result = await service.togglePlugin(tenantId, 'analytics', false);
        expect(result).toEqual({ pluginId: 'analytics', enabled: false });
      });

      it('throws PluginDependencyError (422) when enabled plugins depend on target', async () => {
        mockGetBlockingDependents.mockReturnValue(['customer-care', 'marketing']);
        mockQuery.mockResolvedValueOnce({
          rows: [
            { plugin_name: 'customer-data', is_enabled: true },
            { plugin_name: 'customer-care', is_enabled: true },
            { plugin_name: 'marketing', is_enabled: true },
          ],
        });

        await expect(service.togglePlugin(tenantId, 'customer-data', false))
          .rejects.toMatchObject({
            statusCode: 422,
            code: 'PLUGIN_DEPENDENCY_VIOLATION',
            blockingDependents: ['customer-care', 'marketing'],
          });
      });

      it('does NOT cascade-disable dependents (breaking change from old behavior)', async () => {
        mockGetBlockingDependents.mockReturnValue(['customer-care']);
        mockQuery.mockResolvedValueOnce({
          rows: [{ plugin_name: 'customer-care', is_enabled: true }],
        });

        await expect(service.togglePlugin(tenantId, 'customer-data', false)).rejects.toThrow();
        // INSERT must NOT have been called — only the SELECT
        expect(mockQuery).toHaveBeenCalledTimes(1);
      });
    });
  });
```

- [ ] **Step 2: Run failing tests**

```bash
cd backend
npx vitest src/api/v1/admin/tenants/__tests__/admin-tenants.service.test.ts -t "togglePlugin"
```

Expected: tests fail — `PluginDependencyError` not thrown, cascade behavior still present

- [ ] **Step 3: Update AdminTenantsService**

Add imports near the top of `admin-tenants.service.ts`:

```typescript
import { PluginDependencyService } from '../../../../plugins/deps/plugin-dependency.service';
import { PluginDependencyError } from '../../../../common/errors/plugin-dependency.error';
```

Add `PluginDependencyService` to the constructor (inject via NestJS DI — `PluginInfraModule` is `@Global()` so no module import needed):

```typescript
constructor(
  // ... existing injections ...
  private readonly deps: PluginDependencyService,
) {}
```

Replace the `togglePlugin` method (lines 495–545) with:

```typescript
  async togglePlugin(tenantId: string, pluginId: string, enabled: boolean) {
    const manifest = BUILT_IN_MANIFESTS.find((m) => m.name === pluginId);
    if (!manifest) throw new NotFoundException(`Unknown plugin: ${pluginId}`);

    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      const { rows } = await client.query<{ plugin_name: string; is_enabled: boolean }>(
        `SELECT plugin_name, is_enabled FROM tenant_plugins WHERE tenant_id = $1`,
        [tenantId],
      );
      const enabledPlugins = rows.filter((r) => r.is_enabled).map((r) => r.plugin_name);

      if (enabled) {
        const missing = this.deps.getMissingDeps(pluginId, enabledPlugins);
        if (missing.length > 0) {
          throw new PluginDependencyError(pluginId, 'enable', missing, []);
        }
        await client.query(
          `INSERT INTO tenant_plugins (tenant_id, plugin_name, is_enabled)
           VALUES ($1, $2, true)
           ON CONFLICT (tenant_id, plugin_name) DO UPDATE SET is_enabled = true`,
          [tenantId, pluginId],
        );
      } else {
        const blocking = this.deps.getBlockingDependents(pluginId, enabledPlugins);
        if (blocking.length > 0) {
          throw new PluginDependencyError(pluginId, 'disable', [], blocking);
        }
        await client.query(
          `INSERT INTO tenant_plugins (tenant_id, plugin_name, is_enabled)
           VALUES ($1, $2, false)
           ON CONFLICT (tenant_id, plugin_name) DO UPDATE SET is_enabled = false`,
          [tenantId, pluginId],
        );
      }

      await this.cache.delForTenant(tenantId, 'tenant-config', 'enabled-plugins');
      return { pluginId, enabled };
    } finally {
      client.release();
    }
  }
```

- [ ] **Step 4: Run toggle tests — confirm they PASS**

```bash
cd backend
npx vitest src/api/v1/admin/tenants/__tests__/admin-tenants.service.test.ts -t "togglePlugin"
```

Expected: all toggle tests pass

- [ ] **Step 5: Run full test suite — confirm no regressions**

```bash
cd backend
npm test
```

Expected: all tests pass. Any existing test that expected `cascadeDisabled` in the response must be updated to not expect that field (replace with just `{ pluginId, enabled }`).

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/api/v1/admin/tenants/admin-tenants.service.ts \
        src/api/v1/admin/tenants/__tests__/admin-tenants.service.test.ts
git commit -m "feat(admin): replace cascade-disable with dependency-error-and-reject in togglePlugin"
```

---

## Final verification

- [ ] **Run full test suite one last time**

```bash
cd backend
npm test
```

Expected: all tests pass

- [ ] **Check TypeScript compilation**

```bash
cd backend
npx tsc --noEmit
```

Expected: zero errors
