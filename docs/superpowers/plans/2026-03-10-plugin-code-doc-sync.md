# Plugin Code–Doc Sync Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronise plugin system code structure with documentation — move three misplaced files to semantically correct locations (Hướng D) and update the HTML doc with Phase 5 reality content for the "Tạo Plugin", "Cơ chế Scan", and "Cấu trúc Plugin" tabs (Hướng A).

**Architecture:** Two independent tracks. Track 1 (code): relocate three source files and update all import paths; no logic changes. Track 2 (doc): add Phase 5 "reality" sections alongside existing Phase 6 roadmap content in `crm-plugin-anatomy.html`.

**Tech Stack:** NestJS 10, TypeScript 5, Vitest, HTML (no framework)

---

## Chunk 1: Code File Moves (Hướng D)

Three files are in semantically wrong locations. Moving them requires updating import paths but zero logic changes.

### File Map

| Current path | New path | Why |
|---|---|---|
| `src/plugins/deps/plugin-manifests.token.ts` | `src/plugins/manifest/plugin-manifests.token.ts` | Token belongs with the manifest it names |
| `src/common/errors/plugin-dependency.error.ts` | `src/plugins/deps/plugin-dependency.error.ts` | Error belongs to the dep subsystem |
| `src/workers/bullmq/processors/plugin-init.processor.ts` | `src/plugins/init/plugin-init.processor.ts` | Init logic belongs to plugin system |

**Files that import each moved file:**

`plugin-manifests.token.ts` (2 consumers):
- `src/plugins/deps/plugin-dependency.service.ts` — `import ... from './plugin-manifests.token'`
- `src/plugins/plugin-infra.module.ts` — `import ... from './deps/plugin-manifests.token'`

`plugin-dependency.error.ts` (5 consumers):
- `src/common/errors/index.ts` — barrel re-export (keep re-export, update source path)
- `src/gateway/filters/http-exception.filter.ts` — direct import
- `src/api/v1/admin/tenants/admin-tenants.service.ts` — direct import
- `src/api/v1/admin/tenants/__tests__/admin-tenants.service.test.ts` — direct import
- `src/gateway/__tests__/http-exception.filter.test.ts` — imports via `../../common/errors` barrel (no change needed if barrel is kept)

`plugin-init.processor.ts` (4 consumers):
- `src/workers/bullmq/bullmq.module.ts` — direct import
- `src/api/v1/admin/tenants/admin-tenants.service.ts` — `import type { PluginInitJobData }`
- `src/api/v1/admin/tenants/__tests__/admin-tenants.service.test.ts` — `import type { PluginInitJobData }`
- `src/workers/bullmq/processors/__tests__/plugin-init.processor.test.ts` — direct import from `../plugin-init.processor`; this test file moves with the processor to `src/plugins/init/__tests__/plugin-init.processor.test.ts`

---

### Task 1: Move `plugin-manifests.token.ts` → `src/plugins/manifest/`

**Files:**
- Move: `src/plugins/deps/plugin-manifests.token.ts` → `src/plugins/manifest/plugin-manifests.token.ts`
- Modify: `src/plugins/deps/plugin-dependency.service.ts`
- Modify: `src/plugins/plugin-infra.module.ts`

- [ ] **Step 1: Move the file**

```bash
mv src/plugins/deps/plugin-manifests.token.ts src/plugins/manifest/plugin-manifests.token.ts
```

- [ ] **Step 2: Update import in `plugin-dependency.service.ts`**

Find line: `import { PLUGIN_MANIFESTS } from './plugin-manifests.token';`
Replace with: `import { PLUGIN_MANIFESTS } from '../manifest/plugin-manifests.token';`

- [ ] **Step 3: Update import in `plugin-infra.module.ts`**

Find line: `import { PLUGIN_MANIFESTS } from './deps/plugin-manifests.token';`
Replace with: `import { PLUGIN_MANIFESTS } from './manifest/plugin-manifests.token';`

- [ ] **Step 4: Run tests**

```bash
npm test -- --reporter=dot
```

Expected: same pass/fail count as before (430 pass, 2 pre-existing failures in QueryInterceptor).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/manifest/plugin-manifests.token.ts \
        src/plugins/deps/plugin-dependency.service.ts \
        src/plugins/plugin-infra.module.ts
git commit -m "refactor(plugins): move plugin-manifests.token to manifest/ directory"
```

---

### Task 2: Move `plugin-dependency.error.ts` → `src/plugins/deps/`

**Files:**
- Move: `src/common/errors/plugin-dependency.error.ts` → `src/plugins/deps/plugin-dependency.error.ts`
- Modify: `src/common/errors/index.ts` (update re-export source path)
- Modify: `src/gateway/filters/http-exception.filter.ts` (direct import)
- Modify: `src/api/v1/admin/tenants/admin-tenants.service.ts` (direct import)
- Modify: `src/api/v1/admin/tenants/__tests__/admin-tenants.service.test.ts` (direct import)

- [ ] **Step 1: Move the file**

```bash
mv src/common/errors/plugin-dependency.error.ts src/plugins/deps/plugin-dependency.error.ts
```

- [ ] **Step 2: Update barrel export in `src/common/errors/index.ts`**

Find line: `export { PluginDependencyError } from './plugin-dependency.error';`
Replace with: `export { PluginDependencyError } from '../../plugins/deps/plugin-dependency.error';`

This keeps the barrel working — callers importing from `common/errors` (e.g. the filter test) require no changes.

- [ ] **Step 3: Update direct import in `http-exception.filter.ts`**

Find line: `import { PluginDependencyError } from '../../common/errors/plugin-dependency.error';`
Replace with: `import { PluginDependencyError } from '../../plugins/deps/plugin-dependency.error';`

(File is at `src/gateway/filters/` — 2 levels up to `src/`, then `plugins/deps/`)

- [ ] **Step 4: Update direct import in `admin-tenants.service.ts`**

Find line: `import { PluginDependencyError } from '../../../../common/errors/plugin-dependency.error';`
Replace with: `import { PluginDependencyError } from '../../../../plugins/deps/plugin-dependency.error';`

(File is at `src/api/v1/admin/tenants/`, 4 levels up to `src/`)

- [ ] **Step 5: Update direct import in `admin-tenants.service.test.ts`**

Find line: `import { PluginDependencyError } from '../../../../common/errors/plugin-dependency.error';`
Replace with: `import { PluginDependencyError } from '../../../../../plugins/deps/plugin-dependency.error';`

(File is at `src/api/v1/admin/tenants/__tests__/` — 5 levels deep, so 5 `../` to reach `src/`)

- [ ] **Step 6: Run tests**

```bash
npm test -- --reporter=dot
```

Expected: 430 pass, 2 pre-existing failures.

- [ ] **Step 7: Commit**

```bash
git add src/plugins/deps/plugin-dependency.error.ts \
        src/common/errors/index.ts \
        src/gateway/filters/http-exception.filter.ts \
        src/api/v1/admin/tenants/admin-tenants.service.ts \
        src/api/v1/admin/tenants/__tests__/admin-tenants.service.test.ts
git commit -m "refactor(plugins): move plugin-dependency.error to plugins/deps/ directory"
```

---

### Task 3: Move `plugin-init.processor.ts` → `src/plugins/init/`

**Files:**
- Create dir: `src/plugins/init/`
- Move: `src/workers/bullmq/processors/plugin-init.processor.ts` → `src/plugins/init/plugin-init.processor.ts`
- Move: `src/workers/bullmq/processors/__tests__/plugin-init.processor.test.ts` → `src/plugins/init/__tests__/plugin-init.processor.test.ts`
- Modify: `src/workers/bullmq/bullmq.module.ts`
- Modify: `src/api/v1/admin/tenants/admin-tenants.service.ts`
- Modify: `src/api/v1/admin/tenants/__tests__/admin-tenants.service.test.ts`

- [ ] **Step 1: Create target directories and move files**

```bash
mkdir -p src/plugins/init/__tests__
mv src/workers/bullmq/processors/plugin-init.processor.ts src/plugins/init/plugin-init.processor.ts
mv src/workers/bullmq/processors/__tests__/plugin-init.processor.test.ts \
   src/plugins/init/__tests__/plugin-init.processor.test.ts
```

- [ ] **Step 2: Fix import inside the test file (was `../plugin-init.processor`)**

File: `src/plugins/init/__tests__/plugin-init.processor.test.ts`

Find: `from '../plugin-init.processor'`
Replace with: `from '../plugin-init.processor'`

This import stays the same since the test moved with the processor — both are one level apart. No change needed.

- [ ] **Step 3: Update import in `bullmq.module.ts`**

File: `src/workers/bullmq/bullmq.module.ts`

Find: `import { PluginInitProcessor } from './processors/plugin-init.processor';`
Replace with: `import { PluginInitProcessor } from '../../plugins/init/plugin-init.processor';`

(File is at `src/workers/bullmq/`, 2 levels up to `src/`, then `plugins/init/`)

- [ ] **Step 4: Update `import type { PluginInitJobData }` in `admin-tenants.service.ts`**

File: `src/api/v1/admin/tenants/admin-tenants.service.ts`

Find: `import type { PluginInitJobData } from '../../../../workers/bullmq/processors/plugin-init.processor';`
Replace with: `import type { PluginInitJobData } from '../../../../plugins/init/plugin-init.processor';`

- [ ] **Step 5: Update same import in `admin-tenants.service.test.ts`**

File: `src/api/v1/admin/tenants/__tests__/admin-tenants.service.test.ts`

Find: `import type { PluginInitJobData } from '../../../../workers/bullmq/processors/plugin-init.processor';`
Replace with: `import type { PluginInitJobData } from '../../../../../plugins/init/plugin-init.processor';`

(File is at `src/api/v1/admin/tenants/__tests__/` — 5 levels deep, so 5 `../` to reach `src/`)

- [ ] **Step 6: Run tests**

```bash
npm test -- --reporter=dot
```

Expected: 430 pass, 2 pre-existing failures.

- [ ] **Step 7: Commit**

```bash
git add src/plugins/init/ \
        src/workers/bullmq/bullmq.module.ts \
        src/api/v1/admin/tenants/admin-tenants.service.ts \
        src/api/v1/admin/tenants/__tests__/admin-tenants.service.test.ts
git commit -m "refactor(plugins): move plugin-init.processor to plugins/init/ directory"
```

---

## Chunk 2: Doc Updates (Hướng A)

Add Phase 5 reality sections to three tabs in `docs/crm-plugin-anatomy.html`. Each section sits **after** the existing Phase 6 roadmap content in its tab — the roadmap is preserved as-is.

The doc uses these CSS classes for code blocks:
- `.dg` + `<pre>` — monospace diagram block
- `.dg-label` — label in top-right corner of block
- `.nt.am` — amber callout note
- `.nt.gn` — green callout note
- `.nt.bl` — blue callout note
- `<span class="hi">` — blue highlight; `<span class="cm">` — grey comment; `<span class="ty">` — yellow type; `<span class="gn">` — green; `<span class="rd">` — red; `<span class="st">` — string green; `<span class="fn">` — function blue; `<span class="nu">` — number orange; `<span class="am">` — amber

No tests needed for doc changes. Verify visually by opening the HTML in a browser.

---

### Task 4: Add Phase 5 directory tree to "Cấu trúc Plugin" tab (`p-anatomy`)

**File:** `docs/crm-plugin-anatomy.html`

Insert a new section between the existing Section 02 (Vai trò từng thành phần) and the end of `p-anatomy`. The section should show the actual `src/plugins/` directory tree, module wiring, and explain NestJS DI approach vs the Phase 6 per-plugin folder model.

- [ ] **Step 1: Find the insertion point**

The `p-anatomy` panel ends with `</div>` closing Section 02 and then the panel's own `</div>`. Insert the new section (Section 02b) between Section 02's closing `</div>` and the panel's closing `</div>`.

Unique anchor to find end of Section 02:
```
</pre>
                </div>
            </div>

        </div>

        <!-- ═══════════════════════════════════════ -->
        <!-- 2. CREATE -->
```

- [ ] **Step 2: Insert new section before the CREATE comment**

Insert after Section 02's closing `</div></div>` and before the CREATE panel comment:

```html
            <div class="sec">
                <div class="sec-h"><span class="sec-n">02b</span>
                    <h2 class="sec-t"><span data-lang="vi">Cấu trúc thực tế — Phase 5</span><span data-lang="en">Actual Structure — Phase 5</span></h2>
                </div>

                <div class="nt gn" data-lang="vi"><strong>Phase 5 thực tế:</strong> Toàn bộ plugin system nằm trong <code>backend/src/plugins/</code>. Không có per-plugin folder hay artifact — mỗi plugin là một NestJS module trong cùng monorepo.</div>
                <div class="nt gn" data-lang="en"><strong>Phase 5 reality:</strong> The entire plugin system lives under <code>backend/src/plugins/</code>. No per-plugin folders or artifacts — each plugin is a NestJS module in the same monorepo.</div>

                <div class="dg">
                    <div class="dg-label">src/plugins/ — actual layout</div>
                    <pre>
<span class="hi">src/plugins/</span>
│
├── <span class="ty">manifest/</span>                    <span class="cm">← Tất cả manifests tập trung ở đây</span>
│   ├── built-in-manifests.ts    <span class="cm">← 5 manifest constants + BUILT_IN_MANIFESTS[]</span>
│   └── plugin-manifests.token.ts <span class="cm">← DI token: PLUGIN_MANIFESTS = 'PLUGIN_MANIFESTS'</span>
│
├── <span class="ty">interfaces/</span>                  <span class="cm">← Type definitions</span>
│   ├── plugin-manifest.interface.ts  <span class="cm">← PluginManifest, PluginHookDef, PluginResourceLimits</span>
│   ├── plugin-core.interface.ts      <span class="cm">← IPluginCore { manifest: PluginManifest }</span>
│   └── execution-context.interface.ts
│
├── <span class="ty">cores/</span>                       <span class="cm">← 1 subdirectory per plugin</span>
│   ├── customer-data/
│   │   ├── customer-data.core.ts       <span class="cm">← Business logic, OnModuleInit self-register</span>
│   │   ├── customer-data.controller.ts <span class="cm">← REST routes under /api/v1/plugins/customer-data/</span>
│   │   ├── customer-data.module.ts     <span class="cm">← NestJS module wiring</span>
│   │   └── dto/create-customer.dto.ts
│   ├── customer-care/  <span class="cm">(same pattern)</span>
│   ├── analytics/      <span class="cm">(same pattern)</span>
│   ├── automation/     <span class="cm">(same pattern)</span>
│   └── marketing/      <span class="cm">(same pattern)</span>
│
├── <span class="ty">deps/</span>                        <span class="cm">← Dependency validation subsystem</span>
│   ├── plugin-dependency.service.ts  <span class="cm">← validateGraph(), getMissingDeps(), getBlockingDependents()</span>
│   └── plugin-dependency.error.ts    <span class="cm">← PluginDependencyError extends AppError (HTTP 422)</span>
│
├── <span class="ty">init/</span>                        <span class="cm">← First-enable initialization</span>
│   └── plugin-init.processor.ts     <span class="cm">← BullMQ @Processor(QUEUE_PLUGIN_INIT), idempotency via initialized_at</span>
│
├── <span class="ty">hooks/</span>
│   └── hook-registry.service.ts     <span class="cm">← before/after/filter hooks, priority ordering</span>
│
├── <span class="ty">registry/</span>
│   └── plugin-registry.service.ts   <span class="cm">← In-memory Map of loaded cores; getEnabledPlugins() from DB</span>
│
├── <span class="ty">sandbox/</span>
│   ├── sandbox.service.ts           <span class="cm">← Promise.race timeout wrapper (5 s, 50 queries)</span>
│   ├── isolated-sandbox.service.ts  <span class="cm">← V8 isolate (Phase 6+, not active)</span>
│   └── sandbox-bridge.ts
│
├── <span class="ty">context/</span>
│   ├── execution-context-builder.service.ts  <span class="cm">← Assembles per-request ExecutionContext</span>
│   └── execution-context.ts                  <span class="cm">← Concrete class holding tenant, user, enabledPlugins, db, cache</span>
│
├── <span class="ty">plugin-infra.module.ts</span>       <span class="cm">← @Global() — provides & exports all infra services</span>
├── <span class="ty">plugins.module.ts</span>            <span class="cm">← Imports infra + 5 core modules; runs validateGraph() on init</span>
└── <span class="ty">plugins-list.controller.ts</span>   <span class="cm">← GET /api/v1/plugins → { enabledPlugins: string[] }</span>


<span class="ty">Module wiring summary:</span>

  AppModule
    └── ApiModule
          └── PluginsModule                 <span class="cm">← OnModuleInit: validateGraph()</span>
                ├── PluginInfraModule  <span class="cm">(@Global — MUST be first import)</span>
                │     provides: PLUGIN_MANIFESTS token, PluginDependencyService,
                │               PluginRegistryService, ExecutionContextBuilder,
                │               HookRegistryService, SandboxService
                ├── CustomerDataModule
                ├── CustomerCareModule       <span class="cm">← OnModuleInit: registry.register(this)</span>
                ├── AnalyticsModule          <span class="cm">← OnModuleInit: registry.register(this)</span>
                ├── AutomationModule         <span class="cm">← OnModuleInit: registry.register(this)</span>
                └── MarketingModule          <span class="cm">← OnModuleInit: registry.register(this)</span></pre>
                </div>
            </div>
```

- [ ] **Step 3: Verify in browser** — open `docs/crm-plugin-anatomy.html`, check "Cấu trúc Plugin" tab renders the new section correctly.

- [ ] **Step 4: Commit**

```bash
git add docs/crm-plugin-anatomy.html
git commit -m "docs: add Phase 5 actual directory structure to Cấu trúc Plugin tab"
```

---

### Task 5: Add Phase 5 creation guide to "Tạo Plugin" tab (`p-create`)

**File:** `docs/crm-plugin-anatomy.html`

Insert a new section after the existing Phase 6 pipeline (Section 03) inside `p-create`. The new section shows the actual 6-step NestJS module creation process.

- [ ] **Step 1: Find insertion point**

Unique anchor — the end of Section 03:
```
└── <span class="cm">End of creation pipeline</span></pre>
                </div>
            </div>
        </div>
```

- [ ] **Step 2: Insert new section before `</div>` closing `p-create`**

```html
            <div class="sec">
                <div class="sec-h"><span class="sec-n">03b</span>
                    <h2 class="sec-t"><span data-lang="vi">Tạo Plugin mới — Phase 5 thực tế</span><span data-lang="en">Create a New Plugin — Phase 5 Reality</span></h2>
                </div>

                <div class="nt gn" data-lang="vi">Không có CLI tool hay artifact registry. Tạo plugin = thêm NestJS module vào <code>src/plugins/cores/</code>, khai báo manifest, register trong <code>PluginsModule</code>.</div>
                <div class="nt gn" data-lang="en">No CLI tool or artifact registry. Creating a plugin = adding a NestJS module to <code>src/plugins/cores/</code>, declaring a manifest, and registering in <code>PluginsModule</code>.</div>

                <div class="dg">
                    <div class="dg-label">create plugin — phase 5</div>
                    <pre>
<span class="hi">Ví dụ: tạo plugin "loyalty-program"</span>

<span class="ty">① Khai báo Manifest</span>   <span class="cm">src/plugins/manifest/built-in-manifests.ts</span>
│
│  export const LOYALTY_MANIFEST: PluginManifest = {
│    name:         <span class="st">'loyalty-program'</span>,
│    version:      <span class="st">'1.0.0'</span>,
│    description:  <span class="st">'Points and rewards for customers'</span>,
│    dependencies: [<span class="st">'customer-data'</span>],             <span class="cm">← deps phải enabled trước</span>
│    permissions:  [<span class="st">'customers:read'</span>, <span class="st">'customers:write'</span>],
│    limits:       DEFAULT_LIMITS,               <span class="cm">← { timeoutMs: 5000, memoryMb: 50, maxQueries: 50 }</span>
│    hooks: [
│      { event: <span class="st">'customer.create'</span>, type: <span class="st">'after'</span>, priority: 20 },
│    ],
│  };
│
│  <span class="cm">// Thêm vào array:</span>
│  export const BUILT_IN_MANIFESTS = [
│    ...,
│    <span class="hi">LOYALTY_MANIFEST</span>,
│  ];
│
▼
<span class="ty">② Tạo Core</span>   <span class="cm">src/plugins/cores/loyalty-program/loyalty-program.core.ts</span>
│
│  @Injectable()
│  export class LoyaltyProgramCore implements IPluginCore, OnModuleInit {
│    readonly manifest = LOYALTY_MANIFEST;
│
│    constructor(
│      private readonly registry: PluginRegistryService,
│      private readonly hookRegistry: HookRegistryService,
│    ) {}
│
│    onModuleInit(): void {
│      this.registry.register(this);
│      <span class="cm">// Register hook handlers:</span>
│      this.hookRegistry.register(
│        <span class="st">'loyalty-program'</span>,
│        { event: <span class="st">'customer.create'</span>, type: <span class="st">'after'</span>, priority: 20 },
│        async (ctx, data) => { <span class="cm">/* award signup points */</span> },
│      );
│    }
│
│    async getPoints(ctx: IExecutionContext, customerId: string) {
│      <span class="cm">// Use ctx.db — QueryInterceptor scopes to tenant automatically</span>
│      return ctx.db.db('loyalty_points').where({ customer_id: customerId });
│    }
│  }
│
▼
<span class="ty">③ Tạo Controller</span>   <span class="cm">src/plugins/cores/loyalty-program/loyalty-program.controller.ts</span>
│
│  @Controller(<span class="st">'api/v1/plugins/loyalty-program'</span>)
│  export class LoyaltyProgramController {
│    constructor(
│      private readonly core: LoyaltyProgramCore,
│      private readonly contextBuilder: ExecutionContextBuilder,
│      private readonly sandbox: SandboxService,
│    ) {}
│
│    @Get(<span class="st">'points/:customerId'</span>)
│    async getPoints(@Param(<span class="st">'customerId'</span>) id: string,
│                    @CurrentTenant() tenant, @CurrentUser() user, @Req() req) {
│      const ctx = await this.contextBuilder.build(tenant, user, req.correlationId);
│      if (!ctx.enabledPlugins.includes(<span class="st">'loyalty-program'</span>))
│        throw new ForbiddenException(<span class="st">'loyalty-program plugin not enabled'</span>);
│      return this.sandbox.execute(
│        () => this.core.getPoints(ctx, id),
│        this.core.manifest.limits.timeoutMs,
│      );
│    }
│  }
│
▼
<span class="ty">④ Tạo NestJS Module</span>   <span class="cm">src/plugins/cores/loyalty-program/loyalty-program.module.ts</span>
│
│  @Module({
│    controllers: [LoyaltyProgramController],
│    providers:   [LoyaltyProgramCore],
│  })
│  export class LoyaltyProgramModule {}
│
▼
<span class="ty">⑤ Register trong PluginsModule</span>   <span class="cm">src/plugins/plugins.module.ts</span>
│
│  @Module({
│    imports: [
│      PluginInfraModule,       <span class="cm">← MUST be first</span>
│      CustomerDataModule,
│      ...,
│      <span class="hi">LoyaltyProgramModule</span>,  <span class="cm">← thêm vào đây</span>
│    ],
│    controllers: [PluginsListController],
│  })
│  export class PluginsModule implements OnModuleInit { ... }
│
▼
<span class="ty">⑥ Chạy DB migration</span>   <span class="cm">nếu plugin cần table riêng</span>
│
│  <span class="cm">// src/db/migrations/20260311000010_loyalty_points.ts</span>
│  export async function up(knex: Knex): Promise<span class="ty">&lt;void&gt;</span> {
│    await knex.schema.createTable(<span class="st">'loyalty_points'</span>, (t) => {
│      t.uuid(<span class="st">'id'</span>).primary().defaultTo(knex.raw(<span class="st">'gen_random_uuid()'</span>));
│      t.uuid(<span class="st">'tenant_id'</span>).notNullable();  <span class="cm">← RLS sẽ enforce</span>
│      t.uuid(<span class="st">'customer_id'</span>).notNullable();
│      t.integer(<span class="st">'points'</span>).defaultTo(0);
│    });
│    await knex.raw(<span class="st">'ALTER TABLE loyalty_points ENABLE ROW LEVEL SECURITY'</span>);
│  }
│
│  npm run db:migrate
│
└── <span class="gn">✓ Plugin sẵn sàng. Admin bật cho tenant qua PATCH /api/v1/admin/tenants/:id/plugins/loyalty-program</span>


<span class="ty">Quy tắc bắt buộc khi viết Core:</span>
  <span class="rd">✗</span> Không thêm WHERE tenant_id = ? — QueryInterceptor tự inject
  <span class="rd">✗</span> Không import fs, net, process, child_process
  <span class="rd">✗</span> Không giữ state trong biến module-level
  <span class="gn">✓</span> Mọi DB access qua ctx.db (Knex)
  <span class="gn">✓</span> Stateless — inject deps qua constructor
  <span class="gn">✓</span> PluginInfraModule @Global → không cần import lại HookRegistryService, etc.</pre>
                </div>
            </div>
```

- [ ] **Step 3: Verify in browser** — "Tạo Plugin" tab shows new Phase 5 section below the Phase 6 pipeline.

- [ ] **Step 4: Commit**

```bash
git add docs/crm-plugin-anatomy.html
git commit -m "docs: add Phase 5 plugin creation guide to Tạo Plugin tab"
```

---

### Task 6: Add Phase 5 bootstrap flow to "Cơ chế Scan" tab (`p-scan`)

**File:** `docs/crm-plugin-anatomy.html`

Insert a new section after Section 05 (Hot Deploy Scan) inside `p-scan`, describing the actual NestJS `OnModuleInit` self-registration flow.

- [ ] **Step 1: Find insertion point**

Unique anchor — end of Section 05 (Hot Deploy):
```
│  <span class="cm">Tất cả instances sync trong ~5 giây</span>
  │  <span class="cm">Existing requests không bị ảnh hưởng</span></pre>
                </div>
            </div>
        </div>
```

- [ ] **Step 2: Insert new section before `</div>` closing `p-scan`**

```html
            <div class="sec">
                <div class="sec-h"><span class="sec-n">05b</span>
                    <h2 class="sec-t"><span data-lang="vi">Bootstrap thực tế — Phase 5</span><span data-lang="en">Actual Bootstrap — Phase 5</span></h2>
                </div>

                <div class="nt gn" data-lang="vi">Không có DB discovery, không có artifact download. NestJS DI container load tất cả module đã hardcode, mỗi core tự đăng ký qua <code>OnModuleInit</code>.</div>
                <div class="nt gn" data-lang="en">No DB discovery, no artifact download. NestJS DI container loads all hardcoded modules; each core self-registers via <code>OnModuleInit</code>.</div>

                <div class="dg">
                    <div class="dg-label">actual bootstrap — phase 5</div>
                    <pre>
<span class="hi">NestJS APP BOOTSTRAP</span>  (src/main.ts → AppModule → ApiModule → PluginsModule)

<span class="ty">Step 1: DI Container khởi tạo PluginInfraModule  <span class="cm">(@Global — MUST be first)</span></span>
│
│  Instantiates (once, singleton):
│    PluginRegistryService        → empty Map&lt;name, IPluginCore&gt;
│    HookRegistryService          → empty Map&lt;key, HookEntry[]&gt;
│    ExecutionContextBuilder
│    SandboxService
│    PluginDependencyService      → indexes BUILT_IN_MANIFESTS by name
│    IsolatedSandboxService       → Phase 6+, not active
│
│  Exports all → available globally via DI
│
▼
<span class="ty">Step 2: DI Container khởi tạo 5 Core Modules</span>  <span class="cm">(all in parallel)</span>
│
│  CustomerDataModule, CustomerCareModule, AnalyticsModule,
│  AutomationModule, MarketingModule
│
│  Each module's Core class is instantiated:
│    constructor injects PluginRegistryService, HookRegistryService (from @Global infra)
│
▼
<span class="ty">Step 3: OnModuleInit() fires for each Core</span>
│
│  <span class="cm">Ví dụ — CustomerCareCore.onModuleInit():</span>
│
│  ┌──────────────────────────────────────────────────────────────────┐
│  │                                                                  │
│  │  <span class="nu">1</span>  this.registry.register(this)                               │
│  │       → pluginCores.set('customer-care', this)                  │
│  │         (Map keyed by manifest.name)                             │
│  │                                                                  │
│  │  <span class="nu">2</span>  this.hookRegistry.register(                                │
│  │         'customer-care',                                         │
│  │         { event: 'customer.create', type: 'after', priority: 10 },│
│  │         async (ctx, data) => { <span class="cm">/* Phase 5: no-op */</span> }            │
│  │       )                                                          │
│  │       → hooks.set('after:customer.create', [..., entry])         │
│  │         sorted by priority ascending                             │
│  │                                                                  │
│  └──────────────────────────────────────────────────────────────────┘
│
│  Sau khi tất cả cores init xong:
│    PluginRegistryService.cores = {
│      'customer-data': CustomerDataCore,
│      'customer-care': CustomerCareCore,
│      'analytics':     AnalyticsCore,
│      'automation':    AutomationCore,
│      'marketing':     MarketingCore,
│    }
│    HookRegistryService.hooks = {
│      'before:customer.create': [automation handler (priority 5)],
│      'after:customer.create':  [customer-care handler (priority 10)],
│    }
│
▼
<span class="ty">Step 4: PluginsModule.onModuleInit()</span>
│
│  pluginDependencyService.validateGraph()
│    → DFS qua BUILT_IN_MANIFESTS
│    → Phát hiện cycle hoặc missing deps trong manifest declarations
│    → Log warnings — KHÔNG throw, KHÔNG block startup
│
▼
<span class="gn">✓ App ready. Tất cả plugin cores loaded và registered.</span>
  <span class="cm">Enabled-per-tenant state được query từ DB tại request time</span>
  <span class="cm">(qua PluginRegistryService.getEnabledPlugins → tenant_plugins table)</span>


<span class="ty">So sánh Phase 5 vs Phase 6+:</span>

  ┌────────────────────────────┬─────────────────────────┬───────────────────────────┐
  │                            │ Phase 5 (current)       │ Phase 6+ (roadmap)        │
  ├────────────────────────────┼─────────────────────────┼───────────────────────────┤
  │ Discovery source           │ Hardcoded imports       │ plugin_registry DB table  │
  │ Load mechanism             │ NestJS DI container     │ Dynamic artifact download │
  │ Self-registration          │ OnModuleInit()          │ core.onLoad() callback    │
  │ Hot deploy                 │ App restart required    │ MQ broadcast, ~5s sync    │
  │ Manifest storage           │ TypeScript constants    │ plugin.manifest.json      │
  │ Dependency validation      │ PluginDependencyService │ Same + checksum verify    │
  └────────────────────────────┴─────────────────────────┴───────────────────────────┘</pre>
                </div>
            </div>
```

- [ ] **Step 3: Verify in browser** — "Cơ chế Scan" tab shows new Phase 5 section.

- [ ] **Step 4: Commit**

```bash
git add docs/crm-plugin-anatomy.html
git commit -m "docs: add Phase 5 bootstrap self-registration flow to Cơ chế Scan tab"
```

---

## Final Verification

- [ ] Run full test suite: `npm test -- --reporter=dot` — expect 430 pass, 2 pre-existing failures
- [ ] Open `docs/crm-plugin-anatomy.html` in browser, check all 3 doc tabs render correctly
- [ ] Confirm no `contact.create` or old file paths remain: `grep -r "plugin-manifests.token\|plugin-dependency.error\|plugin-init.processor" src/ --include="*.ts" | grep -v "src/plugins/manifest\|src/plugins/deps\|src/plugins/init"` — expect no output
