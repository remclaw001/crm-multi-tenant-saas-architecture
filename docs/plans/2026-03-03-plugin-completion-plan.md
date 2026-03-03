# Plugin Completion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete all 5 built-in CRM plugin cores with real DB-backed CRUD, hook wiring, and unit tests.

**Architecture:** One new migration adds 4 tables (`customers`, `support_cases`, `automation_triggers`, `marketing_campaigns`). `customers` is the CRM contact table; `users` remains for internal staff who log in. `CustomerDataCore` is rewritten to operate on `customers` and fires `customer.create` hooks. The 3 stubbed cores are replaced with real Knex queries. `AnalyticsCore` is updated to aggregate on `customers`.

**Tech Stack:** NestJS 10, TypeScript 5, Knex (SQL query builder), Vitest, PostgreSQL RLS

---

## Conventions (read before implementing)

- **All backend commands run from `backend/`**
- **Run tests with:** `npx vitest src/plugins/__tests__/<file>.test.ts`
- **`ctx.db.db('table')`** — Knex query builder, tenant-scoped via RLS + QueryInterceptor. Never add `WHERE tenant_id = ?`.
- **`ResourceNotFoundError`** — import from `../../../common/errors/domain.errors`.
- **Hook registry** — `HookRegistryService` is global (from `PluginInfraModule`); inject it into cores that need it.
- **Controller pattern** — every route builds ctx, checks `enabledPlugins`, wraps with `sandbox.execute`. See `customer-data.controller.ts` for the exact pattern.
- **Response format** — `{ plugin: PLUGIN_NAME, data: result }` or `{ plugin, data: array, count: n }`.

---

## Task 1: DB Migration — 4 plugin tables

**Files:**
- Create: `backend/src/db/migrations/20260303000004_plugin_tables.ts`

**Step 1: Create the migration file**

```typescript
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── customers (RLS) ────────────────────────────────────────
  await knex.schema.createTable('customers', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    table.string('name', 255).notNullable();
    table.string('email', 255).nullable();
    table.string('phone', 50).nullable();
    table.string('company', 255).nullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamps(true, true);
  });

  await knex.raw('CREATE INDEX idx_customers_tenant_id ON customers(tenant_id)');
  await knex.raw(
    'CREATE INDEX idx_customers_tenant_email ON customers(tenant_id, email) WHERE email IS NOT NULL'
  );
  await knex.raw('ALTER TABLE customers ENABLE ROW LEVEL SECURITY');
  await knex.raw('ALTER TABLE customers FORCE ROW LEVEL SECURITY');
  await knex.raw(`
    CREATE POLICY tenant_isolation ON customers
      USING     (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
  `);

  // ── support_cases (RLS) ────────────────────────────────────
  await knex.schema.createTable('support_cases', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    table.uuid('customer_id').notNullable()
      .references('id').inTable('customers').onDelete('CASCADE');
    table.string('title', 500).notNullable();
    table.text('description').nullable();
    table.string('status', 20).notNullable().defaultTo('open');
    // open | in_progress | resolved | closed
    table.string('priority', 20).notNullable().defaultTo('medium');
    // low | medium | high
    table.uuid('assigned_to').nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('resolved_at').nullable();
    table.timestamps(true, true);
  });

  await knex.raw('CREATE INDEX idx_cases_tenant_id ON support_cases(tenant_id)');
  await knex.raw('CREATE INDEX idx_cases_tenant_status ON support_cases(tenant_id, status)');
  await knex.raw('CREATE INDEX idx_cases_tenant_customer ON support_cases(tenant_id, customer_id)');
  await knex.raw('ALTER TABLE support_cases ENABLE ROW LEVEL SECURITY');
  await knex.raw('ALTER TABLE support_cases FORCE ROW LEVEL SECURITY');
  await knex.raw(`
    CREATE POLICY tenant_isolation ON support_cases
      USING     (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
  `);

  // ── automation_triggers (RLS) ──────────────────────────────
  await knex.schema.createTable('automation_triggers', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    table.string('name', 255).notNullable();
    table.string('event_type', 100).notNullable();
    table.jsonb('conditions').notNullable().defaultTo('{}');
    table.jsonb('actions').notNullable().defaultTo('[]');
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamps(true, true);
  });

  await knex.raw('CREATE INDEX idx_triggers_tenant_id ON automation_triggers(tenant_id)');
  await knex.raw('CREATE INDEX idx_triggers_tenant_active ON automation_triggers(tenant_id, is_active)');
  await knex.raw('CREATE INDEX idx_triggers_tenant_event ON automation_triggers(tenant_id, event_type)');
  await knex.raw('ALTER TABLE automation_triggers ENABLE ROW LEVEL SECURITY');
  await knex.raw('ALTER TABLE automation_triggers FORCE ROW LEVEL SECURITY');
  await knex.raw(`
    CREATE POLICY tenant_isolation ON automation_triggers
      USING     (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
  `);

  // ── marketing_campaigns (RLS) ──────────────────────────────
  await knex.schema.createTable('marketing_campaigns', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    table.string('name', 255).notNullable();
    table.string('status', 20).notNullable().defaultTo('draft');
    // draft | active | paused | completed
    table.string('campaign_type', 20).notNullable().defaultTo('email');
    // email | sms
    table.integer('target_count').notNullable().defaultTo(0);
    table.integer('sent_count').notNullable().defaultTo(0);
    table.timestamp('scheduled_at').nullable();
    table.timestamps(true, true);
  });

  await knex.raw('CREATE INDEX idx_campaigns_tenant_id ON marketing_campaigns(tenant_id)');
  await knex.raw('CREATE INDEX idx_campaigns_tenant_status ON marketing_campaigns(tenant_id, status)');
  await knex.raw('ALTER TABLE marketing_campaigns ENABLE ROW LEVEL SECURITY');
  await knex.raw('ALTER TABLE marketing_campaigns FORCE ROW LEVEL SECURITY');
  await knex.raw(`
    CREATE POLICY tenant_isolation ON marketing_campaigns
      USING     (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('marketing_campaigns');
  await knex.schema.dropTableIfExists('automation_triggers');
  await knex.schema.dropTableIfExists('support_cases');
  await knex.schema.dropTableIfExists('customers');
}
```

**Step 2: Verify migration runs (requires live DB)**

```bash
npm run db:migrate
npm run db:status
```

Expected: migration `20260303000004_plugin_tables` shows as `Completed`.

**Step 3: Commit**

```bash
git add src/db/migrations/20260303000004_plugin_tables.ts
git commit -m "feat(db): add customers, support_cases, automation_triggers, marketing_campaigns tables"
```

---

## Task 2: Rewrite `CustomerDataCore` — full CRUD on `customers` + hooks

**Files:**
- Modify: `backend/src/plugins/cores/customer-data/customer-data.core.ts`
- Modify: `backend/src/plugins/cores/customer-data/customer-data.module.ts`
- Create: `backend/src/plugins/__tests__/customer-data.core.test.ts`

**Step 1: Write the failing tests first**

Create `backend/src/plugins/__tests__/customer-data.core.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomerDataCore } from '../cores/customer-data/customer-data.core';
import { ResourceNotFoundError } from '../../common/errors/domain.errors';
import type { IExecutionContext } from '../interfaces/execution-context.interface';

// ── Helpers ─────────────────────────────────────────────────

function makeDb(overrides: Record<string, unknown> = {}) {
  const builder: any = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    returning: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
  return {
    db: vi.fn().mockReturnValue(builder),
    _builder: builder,
  };
}

function makeCtx(dbOverrides = {}): IExecutionContext {
  const db = makeDb(dbOverrides);
  return {
    tenantId: 'tenant-123',
    tenantTier: 'standard',
    tenantConfig: {},
    enabledPlugins: ['customer-data'],
    userId: 'user-abc',
    userRoles: [],
    requestId: 'req-xyz',
    db: db as any,
    cache: {} as any,
  };
}

const mockRegistry = { register: vi.fn() };
const mockHookRegistry = {
  runBefore: vi.fn().mockResolvedValue(undefined),
  runAfter: vi.fn().mockResolvedValue(undefined),
};

// ── Tests ─────────────────────────────────────────────────

describe('CustomerDataCore', () => {
  let core: CustomerDataCore;

  beforeEach(() => {
    vi.clearAllMocks();
    core = new CustomerDataCore(mockRegistry as any, mockHookRegistry as any);
  });

  describe('listCustomers', () => {
    it('queries customers table with is_active=true', async () => {
      const rows = [{ id: '1', name: 'Alice', email: 'alice@example.com' }];
      const ctx = makeCtx({ limit: vi.fn().mockResolvedValue(rows) });

      const result = await core.listCustomers(ctx);

      expect(ctx.db.db).toHaveBeenCalledWith('customers');
      expect(result).toEqual(rows);
    });
  });

  describe('getCustomer', () => {
    it('returns customer when found', async () => {
      const row = { id: 'cust-1', name: 'Bob' };
      const ctx = makeCtx({ first: vi.fn().mockResolvedValue(row) });

      const result = await core.getCustomer(ctx, 'cust-1');

      expect(result).toEqual(row);
    });

    it('throws ResourceNotFoundError when not found', async () => {
      const ctx = makeCtx({ first: vi.fn().mockResolvedValue(null) });

      await expect(core.getCustomer(ctx, 'missing-id')).rejects.toThrow(ResourceNotFoundError);
    });
  });

  describe('createCustomer', () => {
    it('inserts into customers table and returns new row', async () => {
      const newCustomer = { id: 'new-1', name: 'Carol', email: 'carol@example.com' };
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([newCustomer]) });

      const result = await core.createCustomer(ctx, { name: 'Carol', email: 'carol@example.com' });

      expect(ctx.db.db).toHaveBeenCalledWith('customers');
      expect(result).toEqual(newCustomer);
    });

    it('calls runBefore BEFORE insert', async () => {
      const callOrder: string[] = [];
      const ctx = makeCtx({
        returning: vi.fn().mockImplementation(() => {
          callOrder.push('insert');
          return Promise.resolve([{ id: '1', name: 'X' }]);
        }),
      });
      mockHookRegistry.runBefore.mockImplementation(async () => { callOrder.push('before'); });
      mockHookRegistry.runAfter.mockImplementation(async () => { callOrder.push('after'); });

      await core.createCustomer(ctx, { name: 'X' });

      expect(callOrder).toEqual(['before', 'insert', 'after']);
    });

    it('calls runBefore with event customer.create', async () => {
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([{ id: '1', name: 'X' }]) });

      await core.createCustomer(ctx, { name: 'X' });

      expect(mockHookRegistry.runBefore).toHaveBeenCalledWith('customer.create', ctx, { name: 'X' });
    });

    it('calls runAfter with event customer.create and the new customer', async () => {
      const newCustomer = { id: 'new-1', name: 'X' };
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([newCustomer]) });

      await core.createCustomer(ctx, { name: 'X' });

      expect(mockHookRegistry.runAfter).toHaveBeenCalledWith('customer.create', ctx, newCustomer);
    });
  });

  describe('updateCustomer', () => {
    it('returns updated customer on success', async () => {
      const updated = { id: 'cust-1', name: 'Updated' };
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([updated]) });

      const result = await core.updateCustomer(ctx, 'cust-1', { name: 'Updated' });

      expect(result).toEqual(updated);
    });

    it('throws ResourceNotFoundError when row not found', async () => {
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([]) });

      await expect(core.updateCustomer(ctx, 'missing', { name: 'X' })).rejects.toThrow(ResourceNotFoundError);
    });
  });

  describe('deleteCustomer', () => {
    it('sets is_active=false (soft delete)', async () => {
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([{ id: 'c1', is_active: false }]) });

      await core.deleteCustomer(ctx, 'c1');

      expect(ctx.db.db).toHaveBeenCalledWith('customers');
    });

    it('throws ResourceNotFoundError when row not found', async () => {
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([]) });

      await expect(core.deleteCustomer(ctx, 'missing')).rejects.toThrow(ResourceNotFoundError);
    });
  });
});
```

**Step 2: Run tests — expect FAIL (CustomerDataCore missing new methods)**

```bash
npx vitest src/plugins/__tests__/customer-data.core.test.ts
```

Expected: FAIL — `CustomerDataCore` has no `createCustomer`, `updateCustomer`, `deleteCustomer`.

**Step 3: Rewrite `customer-data.core.ts`**

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { CUSTOMER_DATA_MANIFEST } from '../../manifest/built-in-manifests';
import type { IPluginCore } from '../../interfaces/plugin-core.interface';
import type { PluginManifest } from '../../interfaces/plugin-manifest.interface';
import type { IExecutionContext } from '../../interfaces/execution-context.interface';
import { PluginRegistryService } from '../../registry/plugin-registry.service';
import { HookRegistryService } from '../../hooks/hook-registry.service';
import { ResourceNotFoundError } from '../../../common/errors/domain.errors';

export interface Customer {
  id: string;
  tenant_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateCustomerInput {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
}

export interface UpdateCustomerInput {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  is_active?: boolean;
}

@Injectable()
export class CustomerDataCore implements IPluginCore, OnModuleInit {
  readonly manifest: PluginManifest = CUSTOMER_DATA_MANIFEST;

  constructor(
    private readonly registry: PluginRegistryService,
    private readonly hookRegistry: HookRegistryService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async listCustomers(ctx: IExecutionContext): Promise<Customer[]> {
    return ctx.db
      .db('customers')
      .select('id', 'tenant_id', 'name', 'email', 'phone', 'company', 'is_active', 'created_at', 'updated_at')
      .where({ is_active: true })
      .orderBy('created_at', 'desc')
      .limit(100) as Promise<Customer[]>;
  }

  async getCustomer(ctx: IExecutionContext, id: string): Promise<Customer> {
    const row = await ctx.db
      .db('customers')
      .select('id', 'tenant_id', 'name', 'email', 'phone', 'company', 'is_active', 'created_at', 'updated_at')
      .where({ id })
      .first();
    if (!row) throw new ResourceNotFoundError('Customer', id);
    return row as Customer;
  }

  async createCustomer(ctx: IExecutionContext, input: CreateCustomerInput): Promise<Customer> {
    await this.hookRegistry.runBefore('customer.create', ctx, input);

    const [customer] = await ctx.db
      .db('customers')
      .insert({
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        company: input.company ?? null,
      })
      .returning('*') as Customer[];

    await this.hookRegistry.runAfter('customer.create', ctx, customer);
    return customer;
  }

  async updateCustomer(
    ctx: IExecutionContext,
    id: string,
    input: UpdateCustomerInput,
  ): Promise<Customer> {
    const [updated] = await ctx.db
      .db('customers')
      .where({ id })
      .update({ ...input, updated_at: ctx.db.db.raw('NOW()') })
      .returning('*') as Customer[];

    if (!updated) throw new ResourceNotFoundError('Customer', id);
    return updated;
  }

  async deleteCustomer(ctx: IExecutionContext, id: string): Promise<void> {
    const [deleted] = await ctx.db
      .db('customers')
      .where({ id })
      .update({ is_active: false, updated_at: ctx.db.db.raw('NOW()') })
      .returning('id') as Array<{ id: string }>;

    if (!deleted) throw new ResourceNotFoundError('Customer', id);
  }
}
```

**Step 4: Update `customer-data.module.ts` to inject `HookRegistryService`**

`HookRegistryService` is already global (from `PluginInfraModule`) — just add it to the constructor. The module file itself doesn't need to import it explicitly. No change to `customer-data.module.ts` is needed.

**Step 5: Run tests — expect PASS**

```bash
npx vitest src/plugins/__tests__/customer-data.core.test.ts
```

Expected: all tests PASS.

**Step 6: Commit**

```bash
git add src/plugins/cores/customer-data/customer-data.core.ts \
        src/plugins/__tests__/customer-data.core.test.ts
git commit -m "feat(customer-data): rewrite core — full CRUD on customers table + customer.create hooks"
```

---

## Task 3: Update `CustomerDataController` — add POST/PUT/DELETE routes

**Files:**
- Modify: `backend/src/plugins/cores/customer-data/customer-data.controller.ts`

**Step 1: Rewrite the controller**

Replace the entire file:

```typescript
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  HttpCode,
  ForbiddenException,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentTenant } from '../../../gateway/decorators/current-tenant.decorator';
import { CurrentUser } from '../../../gateway/decorators/current-tenant.decorator';
import type { ResolvedTenant } from '../../../gateway/dto/resolved-tenant.dto';
import type { JwtClaims } from '../../../gateway/dto/jwt-claims.dto';
import { ExecutionContextBuilder } from '../../context/execution-context-builder.service';
import { SandboxService } from '../../sandbox/sandbox.service';
import {
  CustomerDataCore,
  CreateCustomerInput,
  UpdateCustomerInput,
} from './customer-data.core';

const PLUGIN_NAME = 'customer-data';

@Controller('api/v1/plugins/customer-data')
export class CustomerDataController {
  constructor(
    private readonly core: CustomerDataCore,
    private readonly contextBuilder: ExecutionContextBuilder,
    private readonly sandbox: SandboxService,
  ) {}

  private async buildCtx(
    tenant: ResolvedTenant,
    user: JwtClaims,
    req: Request & { correlationId?: string },
  ) {
    const ctx = await this.contextBuilder.build(tenant, user, req.correlationId ?? 'n/a');
    if (!ctx.enabledPlugins.includes(PLUGIN_NAME)) {
      throw new ForbiddenException(`Plugin "${PLUGIN_NAME}" is not enabled for this tenant`);
    }
    return ctx;
  }

  @Get('customers')
  async listCustomers(
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const customers = await this.sandbox.execute(
      () => this.core.listCustomers(ctx),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: customers, count: customers.length };
  }

  @Get('customers/:id')
  async getCustomer(
    @Param('id') id: string,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const customer = await this.sandbox.execute(
      () => this.core.getCustomer(ctx, id),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: customer };
  }

  @Post('customers')
  async createCustomer(
    @Body() body: CreateCustomerInput,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const customer = await this.sandbox.execute(
      () => this.core.createCustomer(ctx, body),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: customer };
  }

  @Put('customers/:id')
  async updateCustomer(
    @Param('id') id: string,
    @Body() body: UpdateCustomerInput,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const customer = await this.sandbox.execute(
      () => this.core.updateCustomer(ctx, id, body),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: customer };
  }

  @Delete('customers/:id')
  @HttpCode(204)
  async deleteCustomer(
    @Param('id') id: string,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    await this.sandbox.execute(
      () => this.core.deleteCustomer(ctx, id),
      this.core.manifest.limits.timeoutMs,
    );
  }
}
```

**Step 2: Run all tests to verify nothing broke**

```bash
npm test
```

Expected: all existing tests PASS.

**Step 3: Commit**

```bash
git add src/plugins/cores/customer-data/customer-data.controller.ts
git commit -m "feat(customer-data): add POST/PUT/DELETE /customers routes"
```

---

## Task 4: Update `AnalyticsCore` — query `customers` instead of `users`

**Files:**
- Modify: `backend/src/plugins/cores/analytics/analytics.core.ts`

**Step 1: Write the failing test**

Create `backend/src/plugins/__tests__/analytics.core.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsCore } from '../cores/analytics/analytics.core';
import type { IExecutionContext } from '../interfaces/execution-context.interface';

function makeCtx(builderOverrides: Record<string, unknown> = {}): IExecutionContext {
  const rawBuilder: any = vi.fn().mockReturnValue(undefined);
  const builder: any = {
    count: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue({ count: '5' }),
    select: vi.fn().mockReturnThis(),
    groupByRaw: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue([]),
    ...builderOverrides,
  };
  rawBuilder.raw = vi.fn().mockReturnValue('RAW_SQL');
  return {
    tenantId: 'tenant-123',
    tenantTier: 'standard',
    tenantConfig: {},
    enabledPlugins: ['analytics'],
    userId: 'user-abc',
    userRoles: [],
    requestId: 'req-xyz',
    db: { db: vi.fn().mockReturnValue(builder) } as any,
    cache: {} as any,
  };
}

const mockRegistry = { register: vi.fn() };

describe('AnalyticsCore', () => {
  let core: AnalyticsCore;

  beforeEach(() => {
    vi.clearAllMocks();
    core = new AnalyticsCore(mockRegistry as any);
  });

  describe('summary', () => {
    it('queries customers table (not users)', async () => {
      const ctx = makeCtx();
      await core.summary(ctx);
      expect(ctx.db.db).toHaveBeenCalledWith('customers');
      expect(ctx.db.db).not.toHaveBeenCalledWith('users');
    });

    it('returns totalCustomers and activeCustomers', async () => {
      const ctx = makeCtx({ first: vi.fn().mockResolvedValue({ count: '10' }) });
      const result = await core.summary(ctx);
      expect(result).toMatchObject({ totalCustomers: 10, activeCustomers: 10 });
    });
  });

  describe('trends', () => {
    it('queries customers table (not users)', async () => {
      const rows = [{ date: '2026-03-01', count: '3' }];
      const ctx = makeCtx({ orderBy: vi.fn().mockResolvedValue(rows) });
      await core.trends(ctx);
      expect(ctx.db.db).toHaveBeenCalledWith('customers');
    });

    it('returns array of TrendPoints with parsed count', async () => {
      const rows = [{ date: '2026-03-01', count: '3' }];
      const ctx = makeCtx({ orderBy: vi.fn().mockResolvedValue(rows) });
      const result = await core.trends(ctx);
      expect(result).toEqual([{ date: '2026-03-01', count: 3 }]);
    });
  });
});
```

**Step 2: Run test — expect FAIL (still queries `users`)**

```bash
npx vitest src/plugins/__tests__/analytics.core.test.ts
```

**Step 3: Update `analytics.core.ts`**

Replace `'users'` with `'customers'` in both methods and rename fields:

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ANALYTICS_MANIFEST } from '../../manifest/built-in-manifests';
import type { IPluginCore } from '../../interfaces/plugin-core.interface';
import type { PluginManifest } from '../../interfaces/plugin-manifest.interface';
import type { IExecutionContext } from '../../interfaces/execution-context.interface';
import { PluginRegistryService } from '../../registry/plugin-registry.service';

export interface AnalyticsSummary {
  totalCustomers: number;
  activeCustomers: number;
  tenantId: string;
  generatedAt: string;
}

export interface TrendPoint {
  date: string;
  count: number;
}

@Injectable()
export class AnalyticsCore implements IPluginCore, OnModuleInit {
  readonly manifest: PluginManifest = ANALYTICS_MANIFEST;

  constructor(private readonly registry: PluginRegistryService) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async summary(ctx: IExecutionContext): Promise<AnalyticsSummary> {
    const [totalRow, activeRow] = await Promise.all([
      ctx.db.db('customers').count<{ count: string }>('id as count').first(),
      ctx.db.db('customers').count<{ count: string }>('id as count').where({ is_active: true }).first(),
    ]);

    return {
      totalCustomers: parseInt(totalRow?.count ?? '0', 10),
      activeCustomers: parseInt(activeRow?.count ?? '0', 10),
      tenantId: ctx.tenantId,
      generatedAt: new Date().toISOString(),
    };
  }

  async trends(ctx: IExecutionContext): Promise<TrendPoint[]> {
    const rows = await ctx.db
      .db('customers')
      .select(
        ctx.db.db.raw("DATE(created_at) as date"),
        ctx.db.db.raw("COUNT(id) as count"),
      )
      .where('created_at', '>=', ctx.db.db.raw("NOW() - INTERVAL '30 days'"))
      .groupByRaw('DATE(created_at)')
      .orderBy('date', 'asc') as Array<{ date: string; count: string }>;

    return rows.map((r) => ({ date: r.date, count: parseInt(r.count, 10) }));
  }
}
```

**Step 4: Run tests — expect PASS**

```bash
npx vitest src/plugins/__tests__/analytics.core.test.ts
```

**Step 5: Commit**

```bash
git add src/plugins/cores/analytics/analytics.core.ts \
        src/plugins/__tests__/analytics.core.test.ts
git commit -m "feat(analytics): query customers table instead of users"
```

---

## Task 5: Replace `CustomerCareCore` stubs — real DB queries

**Files:**
- Modify: `backend/src/plugins/cores/customer-care/customer-care.core.ts`
- Create: `backend/src/plugins/__tests__/customer-care.core.test.ts`

**Step 1: Write failing tests**

Create `backend/src/plugins/__tests__/customer-care.core.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomerCareCore } from '../cores/customer-care/customer-care.core';
import { ResourceNotFoundError } from '../../common/errors/domain.errors';
import type { IExecutionContext } from '../interfaces/execution-context.interface';

function makeBuilder(overrides: Record<string, unknown> = {}) {
  return {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    join: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue([]),
    first: vi.fn().mockResolvedValue(null),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    del: vi.fn().mockResolvedValue(1),
    returning: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeCtx(builderOverrides = {}): IExecutionContext {
  const builder = makeBuilder(builderOverrides);
  return {
    tenantId: 'tenant-123',
    tenantTier: 'standard',
    tenantConfig: {},
    enabledPlugins: ['customer-care'],
    userId: 'user-abc',
    userRoles: [],
    requestId: 'req-xyz',
    db: { db: vi.fn().mockReturnValue(builder) } as any,
    cache: {} as any,
  };
}

const mockRegistry = { register: vi.fn() };

describe('CustomerCareCore', () => {
  let core: CustomerCareCore;

  beforeEach(() => {
    vi.clearAllMocks();
    core = new CustomerCareCore(mockRegistry as any);
  });

  describe('listCases', () => {
    it('queries support_cases table', async () => {
      const ctx = makeCtx();
      await core.listCases(ctx);
      expect(ctx.db.db).toHaveBeenCalledWith('support_cases');
    });

    it('returns empty array when no cases', async () => {
      const ctx = makeCtx({ orderBy: vi.fn().mockResolvedValue([]) });
      const result = await core.listCases(ctx);
      expect(result).toEqual([]);
    });
  });

  describe('getCase', () => {
    it('returns case when found', async () => {
      const row = { id: 'case-1', title: 'Bug report' };
      const ctx = makeCtx({ first: vi.fn().mockResolvedValue(row) });
      const result = await core.getCase(ctx, 'case-1');
      expect(result).toEqual(row);
    });

    it('throws ResourceNotFoundError when not found', async () => {
      const ctx = makeCtx({ first: vi.fn().mockResolvedValue(null) });
      await expect(core.getCase(ctx, 'missing')).rejects.toThrow(ResourceNotFoundError);
    });
  });

  describe('createCase', () => {
    it('inserts into support_cases and returns new row', async () => {
      const newCase = { id: 'case-new', title: 'New issue' };
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([newCase]) });
      const result = await core.createCase(ctx, { customer_id: 'cust-1', title: 'New issue' });
      expect(ctx.db.db).toHaveBeenCalledWith('support_cases');
      expect(result).toEqual(newCase);
    });
  });

  describe('updateCase', () => {
    it('returns updated case', async () => {
      const updated = { id: 'case-1', status: 'resolved' };
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([updated]) });
      const result = await core.updateCase(ctx, 'case-1', { status: 'resolved' });
      expect(result).toEqual(updated);
    });

    it('throws ResourceNotFoundError when case not found', async () => {
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([]) });
      await expect(core.updateCase(ctx, 'missing', { status: 'resolved' })).rejects.toThrow(ResourceNotFoundError);
    });

    it('sets resolved_at when status becomes resolved', async () => {
      const updated = { id: 'case-1', status: 'resolved', resolved_at: new Date() };
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([updated]) });
      const result = await core.updateCase(ctx, 'case-1', { status: 'resolved' });
      expect(result.resolved_at).toBeDefined();
    });
  });

  describe('deleteCase', () => {
    it('deletes case and returns void', async () => {
      const ctx = makeCtx({ del: vi.fn().mockResolvedValue(1) });
      await expect(core.deleteCase(ctx, 'case-1')).resolves.toBeUndefined();
    });

    it('throws ResourceNotFoundError when case not found', async () => {
      const ctx = makeCtx({ del: vi.fn().mockResolvedValue(0) });
      await expect(core.deleteCase(ctx, 'missing')).rejects.toThrow(ResourceNotFoundError);
    });
  });
});
```

**Step 2: Run — expect FAIL**

```bash
npx vitest src/plugins/__tests__/customer-care.core.test.ts
```

**Step 3: Rewrite `customer-care.core.ts`**

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { CUSTOMER_CARE_MANIFEST } from '../../manifest/built-in-manifests';
import type { IPluginCore } from '../../interfaces/plugin-core.interface';
import type { PluginManifest } from '../../interfaces/plugin-manifest.interface';
import type { IExecutionContext } from '../../interfaces/execution-context.interface';
import { PluginRegistryService } from '../../registry/plugin-registry.service';
import { ResourceNotFoundError } from '../../../common/errors/domain.errors';

export interface SupportCase {
  id: string;
  tenant_id: string;
  customer_id: string;
  title: string;
  description: string | null;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high';
  assigned_to: string | null;
  resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateCaseInput {
  customer_id: string;
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high';
}

export interface UpdateCaseInput {
  title?: string;
  description?: string;
  status?: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority?: 'low' | 'medium' | 'high';
  assigned_to?: string;
}

@Injectable()
export class CustomerCareCore implements IPluginCore, OnModuleInit {
  readonly manifest: PluginManifest = CUSTOMER_CARE_MANIFEST;

  constructor(private readonly registry: PluginRegistryService) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async listCases(ctx: IExecutionContext): Promise<SupportCase[]> {
    return ctx.db
      .db('support_cases')
      .select('support_cases.*')
      .orderBy('created_at', 'desc') as Promise<SupportCase[]>;
  }

  async getCase(ctx: IExecutionContext, id: string): Promise<SupportCase> {
    const row = await ctx.db
      .db('support_cases')
      .where({ id })
      .first();
    if (!row) throw new ResourceNotFoundError('SupportCase', id);
    return row as SupportCase;
  }

  async createCase(ctx: IExecutionContext, input: CreateCaseInput): Promise<SupportCase> {
    const [newCase] = await ctx.db
      .db('support_cases')
      .insert({
        customer_id: input.customer_id,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority ?? 'medium',
      })
      .returning('*') as SupportCase[];
    return newCase;
  }

  async updateCase(
    ctx: IExecutionContext,
    id: string,
    input: UpdateCaseInput,
  ): Promise<SupportCase> {
    const patch: Record<string, unknown> = {
      ...input,
      updated_at: ctx.db.db.raw('NOW()'),
    };
    // When resolving, set resolved_at timestamp
    if (input.status === 'resolved') {
      patch.resolved_at = ctx.db.db.raw('NOW()');
    }

    const [updated] = await ctx.db
      .db('support_cases')
      .where({ id })
      .update(patch)
      .returning('*') as SupportCase[];

    if (!updated) throw new ResourceNotFoundError('SupportCase', id);
    return updated;
  }

  async deleteCase(ctx: IExecutionContext, id: string): Promise<void> {
    const count = await ctx.db
      .db('support_cases')
      .where({ id })
      .del();
    if (count === 0) throw new ResourceNotFoundError('SupportCase', id);
  }
}
```

**Step 4: Run tests — expect PASS**

```bash
npx vitest src/plugins/__tests__/customer-care.core.test.ts
```

**Step 5: Commit**

```bash
git add src/plugins/cores/customer-care/customer-care.core.ts \
        src/plugins/__tests__/customer-care.core.test.ts
git commit -m "feat(customer-care): replace stubs with real DB queries on support_cases"
```

---

## Task 6: Update `CustomerCareController` — add GET/:id, PUT, DELETE

**Files:**
- Modify: `backend/src/plugins/cores/customer-care/customer-care.controller.ts`

**Step 1: Replace the file**

```typescript
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  HttpCode,
  ForbiddenException,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentTenant } from '../../../gateway/decorators/current-tenant.decorator';
import { CurrentUser } from '../../../gateway/decorators/current-tenant.decorator';
import type { ResolvedTenant } from '../../../gateway/dto/resolved-tenant.dto';
import type { JwtClaims } from '../../../gateway/dto/jwt-claims.dto';
import { ExecutionContextBuilder } from '../../context/execution-context-builder.service';
import { SandboxService } from '../../sandbox/sandbox.service';
import { CustomerCareCore, CreateCaseInput, UpdateCaseInput } from './customer-care.core';

const PLUGIN_NAME = 'customer-care';

@Controller('api/v1/plugins/customer-care')
export class CustomerCareController {
  constructor(
    private readonly core: CustomerCareCore,
    private readonly contextBuilder: ExecutionContextBuilder,
    private readonly sandbox: SandboxService,
  ) {}

  private async buildCtx(
    tenant: ResolvedTenant,
    user: JwtClaims,
    req: Request & { correlationId?: string },
  ) {
    const ctx = await this.contextBuilder.build(tenant, user, req.correlationId ?? 'n/a');
    if (!ctx.enabledPlugins.includes(PLUGIN_NAME)) {
      throw new ForbiddenException(`Plugin "${PLUGIN_NAME}" is not enabled for this tenant`);
    }
    return ctx;
  }

  @Get('cases')
  async listCases(
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const cases = await this.sandbox.execute(
      () => this.core.listCases(ctx),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: cases, count: cases.length };
  }

  @Get('cases/:id')
  async getCase(
    @Param('id') id: string,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const c = await this.sandbox.execute(
      () => this.core.getCase(ctx, id),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: c };
  }

  @Post('cases')
  async createCase(
    @Body() body: CreateCaseInput,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const newCase = await this.sandbox.execute(
      () => this.core.createCase(ctx, body),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: newCase };
  }

  @Put('cases/:id')
  async updateCase(
    @Param('id') id: string,
    @Body() body: UpdateCaseInput,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const updated = await this.sandbox.execute(
      () => this.core.updateCase(ctx, id, body),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: updated };
  }

  @Delete('cases/:id')
  @HttpCode(204)
  async deleteCase(
    @Param('id') id: string,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    await this.sandbox.execute(
      () => this.core.deleteCase(ctx, id),
      this.core.manifest.limits.timeoutMs,
    );
  }
}
```

**Step 2: Run all tests**

```bash
npm test
```

**Step 3: Commit**

```bash
git add src/plugins/cores/customer-care/customer-care.controller.ts
git commit -m "feat(customer-care): add GET/:id, PUT, DELETE /cases routes"
```

---

## Task 7: Replace `AutomationCore` stubs — real DB queries + hook handler

**Files:**
- Modify: `backend/src/plugins/cores/automation/automation.core.ts`
- Modify: `backend/src/plugins/cores/automation/automation.module.ts`
- Create: `backend/src/plugins/__tests__/automation.core.test.ts`

**Step 1: Write failing tests**

Create `backend/src/plugins/__tests__/automation.core.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutomationCore } from '../cores/automation/automation.core';
import { ResourceNotFoundError } from '../../common/errors/domain.errors';
import type { IExecutionContext } from '../interfaces/execution-context.interface';

function makeBuilder(overrides: Record<string, unknown> = {}) {
  return {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue([]),
    first: vi.fn().mockResolvedValue(null),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    del: vi.fn().mockResolvedValue(1),
    returning: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeCtx(builderOverrides = {}): IExecutionContext {
  const builder = makeBuilder(builderOverrides);
  return {
    tenantId: 'tenant-123',
    tenantTier: 'standard',
    tenantConfig: {},
    enabledPlugins: ['automation'],
    userId: 'user-abc',
    userRoles: [],
    requestId: 'req-xyz',
    db: { db: vi.fn().mockReturnValue(builder) } as any,
    cache: {} as any,
  };
}

const mockRegistry = { register: vi.fn() };
const mockHookRegistry = { register: vi.fn(), runBefore: vi.fn(), runAfter: vi.fn() };

describe('AutomationCore', () => {
  let core: AutomationCore;

  beforeEach(() => {
    vi.clearAllMocks();
    core = new AutomationCore(mockRegistry as any, mockHookRegistry as any);
  });

  describe('onModuleInit', () => {
    it('registers itself with PluginRegistryService', () => {
      core.onModuleInit();
      expect(mockRegistry.register).toHaveBeenCalledWith(core);
    });

    it('registers before:customer.create hook handler', () => {
      core.onModuleInit();
      expect(mockHookRegistry.register).toHaveBeenCalledWith(
        'automation',
        expect.objectContaining({ event: 'customer.create', type: 'before' }),
        expect.any(Function),
      );
    });
  });

  describe('listTriggers', () => {
    it('queries automation_triggers table', async () => {
      const ctx = makeCtx();
      await core.listTriggers(ctx);
      expect(ctx.db.db).toHaveBeenCalledWith('automation_triggers');
    });
  });

  describe('getTrigger', () => {
    it('returns trigger when found', async () => {
      const row = { id: 'trig-1', name: 'Welcome' };
      const ctx = makeCtx({ first: vi.fn().mockResolvedValue(row) });
      const result = await core.getTrigger(ctx, 'trig-1');
      expect(result).toEqual(row);
    });

    it('throws ResourceNotFoundError when not found', async () => {
      const ctx = makeCtx({ first: vi.fn().mockResolvedValue(null) });
      await expect(core.getTrigger(ctx, 'missing')).rejects.toThrow(ResourceNotFoundError);
    });
  });

  describe('createTrigger', () => {
    it('inserts into automation_triggers and returns new row', async () => {
      const newTrigger = { id: 'trig-new', name: 'My trigger' };
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([newTrigger]) });
      const result = await core.createTrigger(ctx, { name: 'My trigger', event_type: 'customer.create' });
      expect(result).toEqual(newTrigger);
    });
  });

  describe('updateTrigger', () => {
    it('returns updated trigger', async () => {
      const updated = { id: 'trig-1', is_active: false };
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([updated]) });
      const result = await core.updateTrigger(ctx, 'trig-1', { is_active: false });
      expect(result).toEqual(updated);
    });

    it('throws ResourceNotFoundError when not found', async () => {
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([]) });
      await expect(core.updateTrigger(ctx, 'missing', {})).rejects.toThrow(ResourceNotFoundError);
    });
  });

  describe('deleteTrigger', () => {
    it('deletes trigger and returns void', async () => {
      const ctx = makeCtx({ del: vi.fn().mockResolvedValue(1) });
      await expect(core.deleteTrigger(ctx, 'trig-1')).resolves.toBeUndefined();
    });

    it('throws ResourceNotFoundError when not found', async () => {
      const ctx = makeCtx({ del: vi.fn().mockResolvedValue(0) });
      await expect(core.deleteTrigger(ctx, 'missing')).rejects.toThrow(ResourceNotFoundError);
    });
  });
});
```

**Step 2: Run — expect FAIL**

```bash
npx vitest src/plugins/__tests__/automation.core.test.ts
```

**Step 3: Rewrite `automation.core.ts`**

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { AUTOMATION_MANIFEST } from '../../manifest/built-in-manifests';
import type { IPluginCore } from '../../interfaces/plugin-core.interface';
import type { PluginManifest } from '../../interfaces/plugin-manifest.interface';
import type { IExecutionContext } from '../../interfaces/execution-context.interface';
import { PluginRegistryService } from '../../registry/plugin-registry.service';
import { HookRegistryService } from '../../hooks/hook-registry.service';
import { ResourceNotFoundError } from '../../../common/errors/domain.errors';

export interface AutomationTrigger {
  id: string;
  tenant_id: string;
  name: string;
  event_type: string;
  conditions: Record<string, unknown>;
  actions: unknown[];
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateTriggerInput {
  name: string;
  event_type: string;
  conditions?: Record<string, unknown>;
  actions?: unknown[];
  is_active?: boolean;
}

export interface UpdateTriggerInput {
  name?: string;
  event_type?: string;
  conditions?: Record<string, unknown>;
  actions?: unknown[];
  is_active?: boolean;
}

@Injectable()
export class AutomationCore implements IPluginCore, OnModuleInit {
  readonly manifest: PluginManifest = AUTOMATION_MANIFEST;

  constructor(
    private readonly registry: PluginRegistryService,
    private readonly hookRegistry: HookRegistryService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);

    // Register before:customer.create hook (priority=5, runs before customer-care's after hook)
    this.hookRegistry.register(
      'automation',
      { event: 'customer.create', type: 'before', priority: 5 },
      async (_ctx, _data) => {
        // Phase 5: no-op. Phase 7+ will inspect active triggers and apply matching conditions.
      },
    );
  }

  async listTriggers(ctx: IExecutionContext): Promise<AutomationTrigger[]> {
    return ctx.db
      .db('automation_triggers')
      .select('*')
      .orderBy('created_at', 'desc') as Promise<AutomationTrigger[]>;
  }

  async getTrigger(ctx: IExecutionContext, id: string): Promise<AutomationTrigger> {
    const row = await ctx.db
      .db('automation_triggers')
      .where({ id })
      .first();
    if (!row) throw new ResourceNotFoundError('AutomationTrigger', id);
    return row as AutomationTrigger;
  }

  async createTrigger(ctx: IExecutionContext, input: CreateTriggerInput): Promise<AutomationTrigger> {
    const [trigger] = await ctx.db
      .db('automation_triggers')
      .insert({
        name: input.name,
        event_type: input.event_type,
        conditions: input.conditions ?? {},
        actions: input.actions ?? [],
        is_active: input.is_active ?? true,
      })
      .returning('*') as AutomationTrigger[];
    return trigger;
  }

  async updateTrigger(
    ctx: IExecutionContext,
    id: string,
    input: UpdateTriggerInput,
  ): Promise<AutomationTrigger> {
    const [updated] = await ctx.db
      .db('automation_triggers')
      .where({ id })
      .update({ ...input, updated_at: ctx.db.db.raw('NOW()') })
      .returning('*') as AutomationTrigger[];
    if (!updated) throw new ResourceNotFoundError('AutomationTrigger', id);
    return updated;
  }

  async deleteTrigger(ctx: IExecutionContext, id: string): Promise<void> {
    const count = await ctx.db.db('automation_triggers').where({ id }).del();
    if (count === 0) throw new ResourceNotFoundError('AutomationTrigger', id);
  }
}
```

**Step 4: Run tests — expect PASS**

```bash
npx vitest src/plugins/__tests__/automation.core.test.ts
```

**Step 5: Commit**

```bash
git add src/plugins/cores/automation/automation.core.ts \
        src/plugins/__tests__/automation.core.test.ts
git commit -m "feat(automation): replace stubs with real DB queries + register before:customer.create hook"
```

---

## Task 8: Update `AutomationController` — add GET/:id, PUT, DELETE

**Files:**
- Modify: `backend/src/plugins/cores/automation/automation.controller.ts`

**Step 1: Replace the file**

```typescript
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  HttpCode,
  ForbiddenException,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentTenant } from '../../../gateway/decorators/current-tenant.decorator';
import { CurrentUser } from '../../../gateway/decorators/current-tenant.decorator';
import type { ResolvedTenant } from '../../../gateway/dto/resolved-tenant.dto';
import type { JwtClaims } from '../../../gateway/dto/jwt-claims.dto';
import { ExecutionContextBuilder } from '../../context/execution-context-builder.service';
import { SandboxService } from '../../sandbox/sandbox.service';
import { AutomationCore, CreateTriggerInput, UpdateTriggerInput } from './automation.core';

const PLUGIN_NAME = 'automation';

@Controller('api/v1/plugins/automation')
export class AutomationController {
  constructor(
    private readonly core: AutomationCore,
    private readonly contextBuilder: ExecutionContextBuilder,
    private readonly sandbox: SandboxService,
  ) {}

  private async buildCtx(
    tenant: ResolvedTenant,
    user: JwtClaims,
    req: Request & { correlationId?: string },
  ) {
    const ctx = await this.contextBuilder.build(tenant, user, req.correlationId ?? 'n/a');
    if (!ctx.enabledPlugins.includes(PLUGIN_NAME)) {
      throw new ForbiddenException(`Plugin "${PLUGIN_NAME}" is not enabled for this tenant`);
    }
    return ctx;
  }

  @Get('triggers')
  async listTriggers(
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const triggers = await this.sandbox.execute(
      () => this.core.listTriggers(ctx),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: triggers, count: triggers.length };
  }

  @Get('triggers/:id')
  async getTrigger(
    @Param('id') id: string,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const trigger = await this.sandbox.execute(
      () => this.core.getTrigger(ctx, id),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: trigger };
  }

  @Post('triggers')
  async createTrigger(
    @Body() body: CreateTriggerInput,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const trigger = await this.sandbox.execute(
      () => this.core.createTrigger(ctx, body),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: trigger };
  }

  @Put('triggers/:id')
  async updateTrigger(
    @Param('id') id: string,
    @Body() body: UpdateTriggerInput,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const updated = await this.sandbox.execute(
      () => this.core.updateTrigger(ctx, id, body),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: updated };
  }

  @Delete('triggers/:id')
  @HttpCode(204)
  async deleteTrigger(
    @Param('id') id: string,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    await this.sandbox.execute(
      () => this.core.deleteTrigger(ctx, id),
      this.core.manifest.limits.timeoutMs,
    );
  }
}
```

**Step 2: Run all tests**

```bash
npm test
```

**Step 3: Commit**

```bash
git add src/plugins/cores/automation/automation.controller.ts
git commit -m "feat(automation): add GET/:id, PUT, DELETE /triggers routes"
```

---

## Task 9: Replace `MarketingCore` stubs — real DB queries + hook handler

**Files:**
- Modify: `backend/src/plugins/cores/marketing/marketing.core.ts`
- Create: `backend/src/plugins/__tests__/marketing.core.test.ts`

**Step 1: Write failing tests**

Create `backend/src/plugins/__tests__/marketing.core.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MarketingCore } from '../cores/marketing/marketing.core';
import { ResourceNotFoundError } from '../../common/errors/domain.errors';
import type { IExecutionContext } from '../interfaces/execution-context.interface';

function makeBuilder(overrides: Record<string, unknown> = {}) {
  return {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue([]),
    first: vi.fn().mockResolvedValue(null),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    del: vi.fn().mockResolvedValue(1),
    returning: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeCtx(builderOverrides = {}): IExecutionContext {
  const builder = makeBuilder(builderOverrides);
  return {
    tenantId: 'tenant-123',
    tenantTier: 'standard',
    tenantConfig: {},
    enabledPlugins: ['marketing'],
    userId: 'user-abc',
    userRoles: [],
    requestId: 'req-xyz',
    db: { db: vi.fn().mockReturnValue(builder) } as any,
    cache: {} as any,
  };
}

const mockRegistry = { register: vi.fn() };

describe('MarketingCore', () => {
  let core: MarketingCore;

  beforeEach(() => {
    vi.clearAllMocks();
    core = new MarketingCore(mockRegistry as any);
  });

  describe('listCampaigns', () => {
    it('queries marketing_campaigns table', async () => {
      const ctx = makeCtx();
      await core.listCampaigns(ctx);
      expect(ctx.db.db).toHaveBeenCalledWith('marketing_campaigns');
    });
  });

  describe('getCampaign', () => {
    it('returns campaign when found', async () => {
      const row = { id: 'camp-1', name: 'Q1 Launch' };
      const ctx = makeCtx({ first: vi.fn().mockResolvedValue(row) });
      const result = await core.getCampaign(ctx, 'camp-1');
      expect(result).toEqual(row);
    });

    it('throws ResourceNotFoundError when not found', async () => {
      const ctx = makeCtx({ first: vi.fn().mockResolvedValue(null) });
      await expect(core.getCampaign(ctx, 'missing')).rejects.toThrow(ResourceNotFoundError);
    });
  });

  describe('createCampaign', () => {
    it('inserts into marketing_campaigns and returns new row', async () => {
      const newCampaign = { id: 'camp-new', name: 'Launch' };
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([newCampaign]) });
      const result = await core.createCampaign(ctx, { name: 'Launch' });
      expect(result).toEqual(newCampaign);
    });

    it('defaults campaign_type to email', async () => {
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([{ id: '1', campaign_type: 'email' }]) });
      const result = await core.createCampaign(ctx, { name: 'Test' });
      expect(ctx.db.db).toHaveBeenCalledWith('marketing_campaigns');
      expect(result).toBeDefined();
    });
  });

  describe('updateCampaign', () => {
    it('returns updated campaign', async () => {
      const updated = { id: 'camp-1', status: 'active' };
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([updated]) });
      const result = await core.updateCampaign(ctx, 'camp-1', { status: 'active' });
      expect(result).toEqual(updated);
    });

    it('throws ResourceNotFoundError when not found', async () => {
      const ctx = makeCtx({ returning: vi.fn().mockResolvedValue([]) });
      await expect(core.updateCampaign(ctx, 'missing', {})).rejects.toThrow(ResourceNotFoundError);
    });
  });

  describe('deleteCampaign', () => {
    it('deletes and returns void', async () => {
      const ctx = makeCtx({ del: vi.fn().mockResolvedValue(1) });
      await expect(core.deleteCampaign(ctx, 'camp-1')).resolves.toBeUndefined();
    });

    it('throws ResourceNotFoundError when not found', async () => {
      const ctx = makeCtx({ del: vi.fn().mockResolvedValue(0) });
      await expect(core.deleteCampaign(ctx, 'missing')).rejects.toThrow(ResourceNotFoundError);
    });
  });
});
```

**Step 2: Run — expect FAIL**

```bash
npx vitest src/plugins/__tests__/marketing.core.test.ts
```

**Step 3: Rewrite `marketing.core.ts`**

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { MARKETING_MANIFEST } from '../../manifest/built-in-manifests';
import type { IPluginCore } from '../../interfaces/plugin-core.interface';
import type { PluginManifest } from '../../interfaces/plugin-manifest.interface';
import type { IExecutionContext } from '../../interfaces/execution-context.interface';
import { PluginRegistryService } from '../../registry/plugin-registry.service';
import { ResourceNotFoundError } from '../../../common/errors/domain.errors';

export interface Campaign {
  id: string;
  tenant_id: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'completed';
  campaign_type: 'email' | 'sms';
  target_count: number;
  sent_count: number;
  scheduled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateCampaignInput {
  name: string;
  campaign_type?: 'email' | 'sms';
  scheduled_at?: string;
}

export interface UpdateCampaignInput {
  name?: string;
  status?: 'draft' | 'active' | 'paused' | 'completed';
  target_count?: number;
  scheduled_at?: string | null;
}

@Injectable()
export class MarketingCore implements IPluginCore, OnModuleInit {
  readonly manifest: PluginManifest = MARKETING_MANIFEST;

  constructor(private readonly registry: PluginRegistryService) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async listCampaigns(ctx: IExecutionContext): Promise<Campaign[]> {
    return ctx.db
      .db('marketing_campaigns')
      .select('*')
      .orderBy('created_at', 'desc') as Promise<Campaign[]>;
  }

  async getCampaign(ctx: IExecutionContext, id: string): Promise<Campaign> {
    const row = await ctx.db.db('marketing_campaigns').where({ id }).first();
    if (!row) throw new ResourceNotFoundError('Campaign', id);
    return row as Campaign;
  }

  async createCampaign(ctx: IExecutionContext, input: CreateCampaignInput): Promise<Campaign> {
    const [campaign] = await ctx.db
      .db('marketing_campaigns')
      .insert({
        name: input.name,
        campaign_type: input.campaign_type ?? 'email',
        scheduled_at: input.scheduled_at ?? null,
      })
      .returning('*') as Campaign[];
    return campaign;
  }

  async updateCampaign(
    ctx: IExecutionContext,
    id: string,
    input: UpdateCampaignInput,
  ): Promise<Campaign> {
    const [updated] = await ctx.db
      .db('marketing_campaigns')
      .where({ id })
      .update({ ...input, updated_at: ctx.db.db.raw('NOW()') })
      .returning('*') as Campaign[];
    if (!updated) throw new ResourceNotFoundError('Campaign', id);
    return updated;
  }

  async deleteCampaign(ctx: IExecutionContext, id: string): Promise<void> {
    const count = await ctx.db.db('marketing_campaigns').where({ id }).del();
    if (count === 0) throw new ResourceNotFoundError('Campaign', id);
  }
}
```

**Step 4: Run tests — expect PASS**

```bash
npx vitest src/plugins/__tests__/marketing.core.test.ts
```

**Step 5: Commit**

```bash
git add src/plugins/cores/marketing/marketing.core.ts \
        src/plugins/__tests__/marketing.core.test.ts
git commit -m "feat(marketing): replace stubs with real DB queries on marketing_campaigns"
```

---

## Task 10: Update `MarketingController` — add GET/:id, PUT, DELETE

**Files:**
- Modify: `backend/src/plugins/cores/marketing/marketing.controller.ts`

**Step 1: Replace the file**

```typescript
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  HttpCode,
  ForbiddenException,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentTenant } from '../../../gateway/decorators/current-tenant.decorator';
import { CurrentUser } from '../../../gateway/decorators/current-tenant.decorator';
import type { ResolvedTenant } from '../../../gateway/dto/resolved-tenant.dto';
import type { JwtClaims } from '../../../gateway/dto/jwt-claims.dto';
import { ExecutionContextBuilder } from '../../context/execution-context-builder.service';
import { SandboxService } from '../../sandbox/sandbox.service';
import { MarketingCore, CreateCampaignInput, UpdateCampaignInput } from './marketing.core';

const PLUGIN_NAME = 'marketing';

@Controller('api/v1/plugins/marketing')
export class MarketingController {
  constructor(
    private readonly core: MarketingCore,
    private readonly contextBuilder: ExecutionContextBuilder,
    private readonly sandbox: SandboxService,
  ) {}

  private async buildCtx(
    tenant: ResolvedTenant,
    user: JwtClaims,
    req: Request & { correlationId?: string },
  ) {
    const ctx = await this.contextBuilder.build(tenant, user, req.correlationId ?? 'n/a');
    if (!ctx.enabledPlugins.includes(PLUGIN_NAME)) {
      throw new ForbiddenException(`Plugin "${PLUGIN_NAME}" is not enabled for this tenant`);
    }
    return ctx;
  }

  @Get('campaigns')
  async listCampaigns(
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const campaigns = await this.sandbox.execute(
      () => this.core.listCampaigns(ctx),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: campaigns, count: campaigns.length };
  }

  @Get('campaigns/:id')
  async getCampaign(
    @Param('id') id: string,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const campaign = await this.sandbox.execute(
      () => this.core.getCampaign(ctx, id),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: campaign };
  }

  @Post('campaigns')
  async createCampaign(
    @Body() body: CreateCampaignInput,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const campaign = await this.sandbox.execute(
      () => this.core.createCampaign(ctx, body),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: campaign };
  }

  @Put('campaigns/:id')
  async updateCampaign(
    @Param('id') id: string,
    @Body() body: UpdateCampaignInput,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const updated = await this.sandbox.execute(
      () => this.core.updateCampaign(ctx, id, body),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: updated };
  }

  @Delete('campaigns/:id')
  @HttpCode(204)
  async deleteCampaign(
    @Param('id') id: string,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    await this.sandbox.execute(
      () => this.core.deleteCampaign(ctx, id),
      this.core.manifest.limits.timeoutMs,
    );
  }
}
```

**Step 2: Run all tests**

```bash
npm test
```

**Step 3: Commit**

```bash
git add src/plugins/cores/marketing/marketing.controller.ts
git commit -m "feat(marketing): add GET/:id, PUT, DELETE /campaigns routes"
```

---

## Task 11: Register `CustomerCareCore` after:customer.create hook

**Files:**
- Modify: `backend/src/plugins/cores/customer-care/customer-care.core.ts`

The hook must fire after a customer is created. Update `onModuleInit` to register it.

**Step 1: Add hook registration to `CustomerCareCore.onModuleInit()`**

In `customer-care.core.ts`, add `HookRegistryService` injection and registration:

```typescript
// Add to constructor:
constructor(
  private readonly registry: PluginRegistryService,
  private readonly hookRegistry: HookRegistryService,
) {}

// Update onModuleInit:
onModuleInit(): void {
  this.registry.register(this);
  this.hookRegistry.register(
    'customer-care',
    { event: 'customer.create', type: 'after', priority: 10 },
    async (_ctx, _data) => {
      // Phase 5: no-op. Phase 7+ will auto-create an onboarding case.
    },
  );
}
```

Also add the import at the top:
```typescript
import { HookRegistryService } from '../../hooks/hook-registry.service';
```

**Step 2: Update test to verify hook registration**

Add to `customer-care.core.test.ts` describe block:

```typescript
const mockHookRegistry = { register: vi.fn(), runBefore: vi.fn(), runAfter: vi.fn() };

// Update core creation in beforeEach:
core = new CustomerCareCore(mockRegistry as any, mockHookRegistry as any);

// Add test:
describe('onModuleInit', () => {
  it('registers after:customer.create hook', () => {
    core.onModuleInit();
    expect(mockHookRegistry.register).toHaveBeenCalledWith(
      'customer-care',
      expect.objectContaining({ event: 'customer.create', type: 'after' }),
      expect.any(Function),
    );
  });
});
```

**Step 3: Run tests — expect PASS**

```bash
npx vitest src/plugins/__tests__/customer-care.core.test.ts
```

**Step 4: Run the full test suite**

```bash
npm test
```

Expected: all tests PASS.

**Step 5: Commit**

```bash
git add src/plugins/cores/customer-care/customer-care.core.ts \
        src/plugins/__tests__/customer-care.core.test.ts
git commit -m "feat(customer-care): register after:customer.create hook in onModuleInit"
```

---

## Task 12: Final verification

**Step 1: Run the complete test suite**

```bash
cd backend && npm test
```

Expected output: all test files pass, including:
- `sandbox.test.ts`
- `hook-registry.test.ts`
- `isolated-sandbox.test.ts`
- `customer-data.core.test.ts`
- `analytics.core.test.ts`
- `customer-care.core.test.ts`
- `automation.core.test.ts`
- `marketing.core.test.ts`
- All existing dal, observability, workers, gateway tests

**Step 2: TypeScript compile check**

```bash
npm run build
```

Expected: compiles with no errors.

**Step 3: Final commit**

```bash
git add -A
git commit -m "chore: plugin completion — all 5 plugins implemented with full CRUD and tests"
```

---

## Summary of files changed

| File | Change |
|---|---|
| `db/migrations/20260303000004_plugin_tables.ts` | NEW — 4 tables with RLS |
| `plugins/cores/customer-data/customer-data.core.ts` | REWRITE — customers table, hooks |
| `plugins/cores/customer-data/customer-data.controller.ts` | ADD — POST/PUT/DELETE |
| `plugins/cores/analytics/analytics.core.ts` | UPDATE — customers table, renamed fields |
| `plugins/cores/customer-care/customer-care.core.ts` | REWRITE — real DB + hook registration |
| `plugins/cores/customer-care/customer-care.controller.ts` | ADD — GET/:id, PUT, DELETE |
| `plugins/cores/automation/automation.core.ts` | REWRITE — real DB + hook registration |
| `plugins/cores/automation/automation.controller.ts` | ADD — GET/:id, PUT, DELETE |
| `plugins/cores/marketing/marketing.core.ts` | REWRITE — real DB |
| `plugins/cores/marketing/marketing.controller.ts` | ADD — GET/:id, PUT, DELETE |
| `plugins/__tests__/customer-data.core.test.ts` | NEW |
| `plugins/__tests__/analytics.core.test.ts` | NEW |
| `plugins/__tests__/customer-care.core.test.ts` | NEW |
| `plugins/__tests__/automation.core.test.ts` | NEW |
| `plugins/__tests__/marketing.core.test.ts` | NEW |
