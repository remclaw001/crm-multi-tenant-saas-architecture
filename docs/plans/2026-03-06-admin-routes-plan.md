# Admin Routes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement all backend `/api/v1/admin/*` routes so the admin console frontend works end-to-end.

**Architecture:** New `AdminModule` under `src/api/v1/admin/` with 3 controllers (auth, tenants, metrics). Admin routes are excluded from `TenantResolverMiddleware` (they're cross-tenant). A `SuperAdminGuard` checks the JWT has `roles: ['super_admin']`. Admin auth reuses the existing `users` table via a special `system` tenant seeded in dev.

**Tech Stack:** NestJS, Knex, pg (metadata pool), PoolRegistry, JwtService, bcrypt (PasswordService), Vitest

---

### Task 1: Seed system tenant + admin user

**Files:**
- Modify: `src/db/seeds/01_tenants.ts`

**Step 1: Add system tenant + admin user to seed**

At the end of the `knex.transaction` callback, after `await seedTenant(initech)`, add:

```typescript
// ── System tenant (admin console super-admin) ─────────────
const [systemTenant] = await trx('tenants')
  .insert({
    name: 'CRM System',
    subdomain: 'system',
    tier: 'standard',
    config: JSON.stringify({ plugins: [], cors_origins: [], max_users: 5 }),
  })
  .returning('*');

await trx.raw(`SELECT set_config('app.tenant_id', ?, true)`, [systemTenant.id]);

const ADMIN_HASH = '$2b$12$62NgubmgJpkVTY.H/RyuS.G85GPegNcn0KlD2q4v0isyVCiTz5poS'; // admin123

const [superAdminRole] = await trx('roles')
  .insert({
    tenant_id: systemTenant.id,
    name: 'super_admin',
    description: 'CRM system super administrator',
  })
  .returning('*');

const [adminUser] = await trx('users')
  .insert({
    tenant_id: systemTenant.id,
    email: 'admin@crm.dev',
    password_hash: ADMIN_HASH,
    name: 'System Admin',
  })
  .returning('*');

await trx('user_roles').insert({
  user_id: adminUser.id,
  role_id: superAdminRole.id,
  tenant_id: systemTenant.id,
});
```

Also update the console.log at the bottom:
```typescript
console.log('   Admin console: admin@crm.dev / admin123');
```

**Step 2: Run seed to verify no errors**

```bash
cd backend && npm run db:seed
```
Expected: `✓  Seed complete: acme (standard), globex (standard), initech (vip)`

**Step 3: Verify admin user in DB**

```bash
cd backend && node -e "
const { Pool } = require('pg');
const p = new Pool({ connectionString: 'postgresql://crm:crm@localhost:54322/crm_dev' });
p.query(\"SELECT u.email, r.name as role FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id JOIN tenants t ON t.id=u.tenant_id WHERE t.subdomain='system'\").then(r => { console.log(r.rows); p.end(); });
"
```
Expected: `[ { email: 'admin@crm.dev', role: 'super_admin' } ]`

**Step 4: Commit**

```bash
git add src/db/seeds/01_tenants.ts
git commit -m "seed: add system tenant and super_admin user for admin console"
```

---

### Task 2: Exclude admin routes from TenantResolverMiddleware

**Files:**
- Modify: `src/gateway/gateway.module.ts`

**Step 1: Add admin path exclusion**

In `gateway.module.ts`, find the first `consumer.apply(...)` block and add the admin path to the exclude list:

```typescript
consumer
  .apply(
    CorrelationIdMiddleware,
    TenantResolverMiddleware,
  )
  .exclude(
    { path: 'health', method: RequestMethod.GET },
    { path: 'ready', method: RequestMethod.GET },
    { path: 'metrics', method: RequestMethod.GET },
    { path: 'api/v1/admin/(.*)', method: RequestMethod.ALL },
  )
  .forRoutes('*');
```

**Step 2: Verify backend still starts**

```bash
cd backend && npm run start:dev
```
Expected: `Nest application successfully started` with no errors.

**Step 3: Commit**

```bash
git add src/gateway/gateway.module.ts
git commit -m "gateway: exclude /api/v1/admin/* from TenantResolverMiddleware"
```

---

### Task 3: SuperAdminGuard

**Files:**
- Create: `src/api/v1/admin/guards/super-admin.guard.ts`
- Create: `src/api/v1/admin/guards/__tests__/super-admin.guard.test.ts`

**Step 1: Write the failing test**

Create `src/api/v1/admin/guards/__tests__/super-admin.guard.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { SuperAdminGuard } from '../super-admin.guard';
import type { JwtClaims } from '../../../../gateway/dto/jwt-claims.dto';

function makeContext(user: unknown): ExecutionContext {
  return {
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('SuperAdminGuard', () => {
  let guard: SuperAdminGuard;

  beforeEach(() => {
    guard = new SuperAdminGuard();
  });

  it('returns true when user has super_admin role', () => {
    const user: Partial<JwtClaims> = { sub: 'u1', roles: ['super_admin'] };
    expect(guard.canActivate(makeContext(user))).toBe(true);
  });

  it('throws UnauthorizedException when req.user is missing', () => {
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(UnauthorizedException);
  });

  it('throws ForbiddenException when user lacks super_admin role', () => {
    const user: Partial<JwtClaims> = { sub: 'u1', roles: ['admin'] };
    expect(() => guard.canActivate(makeContext(user))).toThrow(ForbiddenException);
  });
});
```

**Step 2: Run to verify it fails**

```bash
cd backend && npx vitest src/api/v1/admin/guards/__tests__/super-admin.guard.test.ts
```
Expected: FAIL — `Cannot find module '../super-admin.guard'`

**Step 3: Implement SuperAdminGuard**

Create `src/api/v1/admin/guards/super-admin.guard.ts`:

```typescript
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import type { JwtClaims } from '../../../gateway/dto/jwt-claims.dto';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user?: JwtClaims }>();
    if (!req.user) {
      throw new UnauthorizedException('Authentication required');
    }
    if (!req.user.roles?.includes('super_admin')) {
      throw new ForbiddenException('Super admin access required');
    }
    return true;
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
cd backend && npx vitest src/api/v1/admin/guards/__tests__/super-admin.guard.test.ts
```
Expected: 3 tests PASS

**Step 5: Commit**

```bash
git add src/api/v1/admin/guards/
git commit -m "feat(admin): add SuperAdminGuard"
```

---

### Task 4: AdminAuthService + Controller

**Files:**
- Create: `src/api/v1/admin/admin-auth/admin-auth.service.ts`
- Create: `src/api/v1/admin/admin-auth/admin-auth.controller.ts`
- Create: `src/api/v1/admin/admin-auth/__tests__/admin-auth.service.test.ts`

**Step 1: Write the failing test**

Create `src/api/v1/admin/admin-auth/__tests__/admin-auth.service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

// Hoisted mocks — must be declared before vi.mock()
const mockQuery = vi.hoisted(() => vi.fn());
const mockRelease = vi.hoisted(() => vi.fn());
const mockConnect = vi.hoisted(() => vi.fn());
const mockSign = vi.hoisted(() => vi.fn());
const mockVerify = vi.hoisted(() => vi.fn());

vi.mock('../../../../dal/pool/PoolRegistry', () => ({
  PoolRegistry: vi.fn().mockImplementation(() => ({
    getMetadataPool: () => ({
      connect: mockConnect,
    }),
  })),
}));

vi.mock('@nestjs/jwt', () => ({
  JwtService: vi.fn().mockImplementation(() => ({ sign: mockSign })),
}));

vi.mock('../../../../common/security/password.service', () => ({
  PasswordService: vi.fn().mockImplementation(() => ({ verify: mockVerify })),
}));

import { AdminAuthService } from '../admin-auth.service';
import { PoolRegistry } from '../../../../dal/pool/PoolRegistry';
import { JwtService } from '@nestjs/jwt';
import { PasswordService } from '../../../../common/security/password.service';

const SYSTEM_TENANT = { id: 'sys-t-id', subdomain: 'system' };
const ADMIN_USER = {
  id: 'admin-id', email: 'admin@crm.dev', name: 'Admin',
  password_hash: 'hash', is_active: true, roles: ['super_admin'],
};

describe('AdminAuthService', () => {
  let service: AdminAuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue({
      query: mockQuery,
      release: mockRelease,
    });
    service = new AdminAuthService(
      new (PoolRegistry as any)(),
      new (JwtService as any)(),
      new (PasswordService as any)(),
    );
  });

  it('returns token + user on valid credentials', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [SYSTEM_TENANT] })      // tenant lookup
      .mockResolvedValueOnce({ rows: [ADMIN_USER] });         // user lookup
    mockVerify.mockResolvedValue(true);
    mockSign.mockReturnValue('jwt-token');

    const result = await service.login({ email: 'admin@crm.dev', password: 'admin123' });

    expect(result.token).toBe('jwt-token');
    expect(result.user.email).toBe('admin@crm.dev');
    expect(result.user.role).toBe('super_admin');
  });

  it('throws UnauthorizedException when password is wrong', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [SYSTEM_TENANT] })
      .mockResolvedValueOnce({ rows: [ADMIN_USER] });
    mockVerify.mockResolvedValue(false);

    await expect(
      service.login({ email: 'admin@crm.dev', password: 'wrong' })
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when user not found', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [SYSTEM_TENANT] })
      .mockResolvedValueOnce({ rows: [] });             // no user
    mockVerify.mockResolvedValue(false);

    await expect(
      service.login({ email: 'nobody@crm.dev', password: 'x' })
    ).rejects.toThrow(UnauthorizedException);
  });
});
```

**Step 2: Run to verify it fails**

```bash
cd backend && npx vitest src/api/v1/admin/admin-auth/__tests__/admin-auth.service.test.ts
```
Expected: FAIL — module not found

**Step 3: Implement AdminAuthService**

Create `src/api/v1/admin/admin-auth/admin-auth.service.ts`:

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PoolRegistry } from '../../../../dal/pool/PoolRegistry';
import { PasswordService } from '../../../../common/security/password.service';

export interface AdminLoginDto {
  email: string;
  password: string;
}

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly poolRegistry: PoolRegistry,
    private readonly jwtService: JwtService,
    private readonly passwordService: PasswordService,
  ) {}

  async login(dto: AdminLoginDto) {
    const pool = this.poolRegistry.getMetadataPool();
    const client = await pool.connect();

    try {
      // 1. Find system tenant
      const tenantRes = await client.query<{ id: string; subdomain: string }>(
        `SELECT id, subdomain FROM tenants WHERE subdomain = 'system' AND is_active = true LIMIT 1`,
      );
      const tenant = tenantRes.rows[0];
      if (!tenant) throw new UnauthorizedException('System not configured');

      // 2. Find admin user + role
      const userRes = await client.query<{
        id: string; email: string; name: string;
        password_hash: string; is_active: boolean; roles: string[];
      }>(
        `SELECT u.id, u.email, u.name, u.password_hash, u.is_active,
                COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = $2
         LEFT JOIN roles r ON r.id = ur.role_id AND r.tenant_id = $2
         WHERE u.email = $1 AND u.tenant_id = $2
         GROUP BY u.id`,
        [dto.email, tenant.id],
      );
      const user = userRes.rows[0];

      // 3. Constant-time check
      const DUMMY = '$2b$12$invalidhashusedtoblindtimingXXXXXXXXXXXXXXXXXXXXXXX';
      const valid = await this.passwordService.verify(
        dto.password,
        user?.password_hash ?? DUMMY,
      );

      if (!user || !user.is_active || !valid || !user.roles.includes('super_admin')) {
        throw new UnauthorizedException('Invalid credentials');
      }

      const token = this.jwtService.sign({
        sub: user.id,
        tenant_id: tenant.id,
        email: user.email,
        roles: user.roles,
      });

      return {
        token,
        user: { id: user.id, email: user.email, role: 'super_admin' as const },
      };
    } finally {
      client.release();
    }
  }
}
```

**Step 4: Implement AdminAuthController**

Create `src/api/v1/admin/admin-auth/admin-auth.controller.ts`:

```typescript
import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { Public } from '../../../../gateway/decorators/public.decorator';
import { AdminAuthService, AdminLoginDto } from './admin-auth.service';

@Controller('api/v1/admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post('login')
  @HttpCode(200)
  @Public()
  login(@Body() body: AdminLoginDto) {
    return this.adminAuthService.login(body);
  }
}
```

**Step 5: Run tests to verify they pass**

```bash
cd backend && npx vitest src/api/v1/admin/admin-auth/__tests__/admin-auth.service.test.ts
```
Expected: 3 tests PASS

**Step 6: Commit**

```bash
git add src/api/v1/admin/admin-auth/
git commit -m "feat(admin): add AdminAuthService and controller"
```

---

### Task 5: AdminTenantsService

**Files:**
- Create: `src/api/v1/admin/tenants/admin-tenants.service.ts`
- Create: `src/api/v1/admin/tenants/__tests__/admin-tenants.service.test.ts`

**Step 1: Write the failing test**

Create `src/api/v1/admin/tenants/__tests__/admin-tenants.service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';

const mockQuery = vi.hoisted(() => vi.fn());
const mockRelease = vi.hoisted(() => vi.fn());
const mockAcquire = vi.hoisted(() => vi.fn());
const mockCacheGet = vi.hoisted(() => vi.fn());
const mockCacheDel = vi.hoisted(() => vi.fn());

vi.mock('../../../../dal/pool/PoolRegistry', () => ({
  PoolRegistry: vi.fn().mockImplementation(() => ({
    acquireMetadataConnection: mockAcquire,
  })),
}));

vi.mock('../../../../dal/cache/CacheManager', () => ({
  CacheManager: vi.fn().mockImplementation(() => ({
    get: mockCacheGet,
    del: mockCacheDel,
  })),
}));

import { AdminTenantsService } from '../admin-tenants.service';
import { PoolRegistry } from '../../../../dal/pool/PoolRegistry';
import { CacheManager } from '../../../../dal/cache/CacheManager';

const ROW = {
  id: 'tid', name: 'Acme', subdomain: 'acme',
  tier: 'standard', is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  plugin_count: '2',
};

describe('AdminTenantsService', () => {
  let service: AdminTenantsService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAcquire.mockResolvedValue({ query: mockQuery, release: mockRelease });
    mockCacheGet.mockResolvedValue(null);
    mockCacheDel.mockResolvedValue(undefined);
    service = new AdminTenantsService(
      new (PoolRegistry as any)(),
      new (CacheManager as any)(),
    );
  });

  describe('list', () => {
    it('returns paginated tenants excluding system', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockResolvedValueOnce({ rows: [ROW] });

      const result = await service.list({ page: 1, limit: 20 });
      expect(result.total).toBe(1);
      expect(result.data[0].plan).toBe('standard');
      expect(result.data[0].status).toBe('active');
      expect(result.data[0].pluginCount).toBe(2);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when tenant not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await expect(service.findOne('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('sets is_active to false', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [ROW] });
      await service.softDelete('tid');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('is_active = false'),
        ['tid'],
      );
    });
  });
});
```

**Step 2: Run to verify it fails**

```bash
cd backend && npx vitest src/api/v1/admin/tenants/__tests__/admin-tenants.service.test.ts
```
Expected: FAIL — module not found

**Step 3: Implement AdminTenantsService**

Create `src/api/v1/admin/tenants/admin-tenants.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolRegistry } from '../../../../dal/pool/PoolRegistry';
import { CacheManager } from '../../../../dal/cache/CacheManager';
import { BUILT_IN_MANIFESTS } from '../../.././../plugins/manifest/built-in-manifests';

export interface TenantRow {
  id: string; name: string; subdomain: string;
  tier: string; is_active: boolean;
  created_at: string; updated_at: string;
  plugin_count: string;
}

function rowToTenant(row: TenantRow) {
  return {
    id: row.id,
    name: row.name,
    subdomain: row.subdomain,
    plan: row.tier as 'standard' | 'vip' | 'enterprise',
    status: row.is_active ? 'active' as const : 'suspended' as const,
    pluginCount: Number(row.plugin_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class AdminTenantsService {
  constructor(
    private readonly poolRegistry: PoolRegistry,
    private readonly cache: CacheManager,
  ) {}

  async list(params: { page: number; limit: number; search?: string }) {
    const { page, limit, search } = params;
    const offset = (page - 1) * limit;

    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      const searchClause = search
        ? `AND (t.name ILIKE '%' || $3 || '%' OR t.subdomain ILIKE '%' || $3 || '%')`
        : '';
      const countArgs: unknown[] = [limit, offset];
      const dataArgs: unknown[] = [limit, offset];
      if (search) { countArgs.push(search); dataArgs.push(search); }

      const [countRes, dataRes] = await Promise.all([
        client.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM tenants t
           WHERE t.subdomain != 'system' ${searchClause}`,
          search ? [search] : [],
        ),
        client.query<TenantRow>(
          `SELECT t.id, t.name, t.subdomain, t.tier, t.is_active,
                  t.created_at, t.updated_at,
                  COUNT(tp.id) FILTER (WHERE tp.is_enabled) AS plugin_count
           FROM tenants t
           LEFT JOIN tenant_plugins tp ON tp.tenant_id = t.id
           WHERE t.subdomain != 'system' ${searchClause}
           GROUP BY t.id
           ORDER BY t.created_at DESC
           LIMIT $1 OFFSET $2`,
          dataArgs,
        ),
      ]);

      return {
        data: dataRes.rows.map(rowToTenant),
        total: Number(countRes.rows[0].count),
        page,
        limit,
      };
    } finally {
      client.release();
    }
  }

  async findOne(id: string) {
    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      const res = await client.query<TenantRow>(
        `SELECT t.id, t.name, t.subdomain, t.tier, t.is_active,
                t.created_at, t.updated_at,
                COUNT(tp.id) FILTER (WHERE tp.is_enabled) AS plugin_count
         FROM tenants t
         LEFT JOIN tenant_plugins tp ON tp.tenant_id = t.id
         WHERE t.id = $1
         GROUP BY t.id`,
        [id],
      );
      if (!res.rows[0]) throw new NotFoundException(`Tenant not found: ${id}`);
      return rowToTenant(res.rows[0]);
    } finally {
      client.release();
    }
  }

  async create(input: { name: string; subdomain: string; plan: string }) {
    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      const res = await client.query<TenantRow>(
        `INSERT INTO tenants (name, subdomain, tier, config)
         VALUES ($1, $2, $3, '{}')
         RETURNING id, name, subdomain, tier, is_active, created_at, updated_at`,
        [input.name, input.subdomain, input.plan],
      );
      const row = { ...res.rows[0], plugin_count: '0' };
      return rowToTenant(row);
    } finally {
      client.release();
    }
  }

  async update(id: string, input: { name?: string; status?: string; plan?: string }) {
    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      const sets: string[] = [];
      const args: unknown[] = [];
      if (input.name)   { args.push(input.name);   sets.push(`name = $${args.length}`); }
      if (input.plan)   { args.push(input.plan);   sets.push(`tier = $${args.length}`); }
      if (input.status) { args.push(input.status === 'active'); sets.push(`is_active = $${args.length}`); }
      if (!sets.length) return this.findOne(id);

      args.push(id);
      const res = await client.query<TenantRow>(
        `UPDATE tenants SET ${sets.join(', ')}, updated_at = NOW()
         WHERE id = $${args.length}
         RETURNING id, name, subdomain, tier, is_active, created_at, updated_at`,
        args,
      );
      if (!res.rows[0]) throw new NotFoundException(`Tenant not found: ${id}`);
      const row = { ...res.rows[0], plugin_count: '0' };
      return rowToTenant(row);
    } finally {
      client.release();
    }
  }

  async softDelete(id: string): Promise<void> {
    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      await client.query(
        `UPDATE tenants SET is_active = false, updated_at = NOW() WHERE id = $1`,
        [id],
      );
    } finally {
      client.release();
    }
  }

  async getPlugins(tenantId: string) {
    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      const res = await client.query<{ plugin_name: string; is_enabled: boolean }>(
        `SELECT plugin_name, is_enabled FROM tenant_plugins WHERE tenant_id = $1`,
        [tenantId],
      );
      const enabledMap = new Map(res.rows.map((r) => [r.plugin_name, r.is_enabled]));

      return BUILT_IN_MANIFESTS.map((m) => ({
        id: m.name,
        name: m.name,
        version: m.version,
        enabled: enabledMap.get(m.name) ?? false,
        permissions: m.permissions,
        limits: {
          timeoutMs: m.limits.timeoutMs,
          memoryMb: m.limits.memoryMb,
          maxQueriesPerRequest: m.limits.maxQueries,
        },
      }));
    } finally {
      client.release();
    }
  }

  async togglePlugin(tenantId: string, pluginId: string, enabled: boolean) {
    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      await client.query(
        `INSERT INTO tenant_plugins (tenant_id, plugin_name, is_enabled)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, plugin_name)
         DO UPDATE SET is_enabled = $3`,
        [tenantId, pluginId, enabled],
      );
      // Invalidate enabled-plugins cache for this tenant
      await this.cache.del(`t:${tenantId}:tenant-config:enabled-plugins`);
      return { pluginId, enabled };
    } finally {
      client.release();
    }
  }
}
```

**Step 4: Check BUILT_IN_MANIFESTS export**

The service imports `BUILT_IN_MANIFESTS` as an array. Check if it's exported from `src/plugins/manifest/built-in-manifests.ts`. If not (only individual constants are exported), add the array export at the end of that file:

```typescript
// Add at the bottom of built-in-manifests.ts
export const BUILT_IN_MANIFESTS = [
  CUSTOMER_DATA_MANIFEST,
  CUSTOMER_CARE_MANIFEST,
  ANALYTICS_MANIFEST,
  AUTOMATION_MANIFEST,
  MARKETING_MANIFEST,
];
```

**Step 5: Check CacheManager.del method**

In `src/dal/cache/CacheManager`, verify there is a `del(key: string)` method. If not, check the actual method name and update the import in `admin-tenants.service.ts` accordingly. The cache invalidation in `togglePlugin` is a best-effort operation — if `del` doesn't exist, use `cache.set` with a very short TTL of 1s instead.

**Step 6: Run tests to verify they pass**

```bash
cd backend && npx vitest src/api/v1/admin/tenants/__tests__/admin-tenants.service.test.ts
```
Expected: tests PASS

**Step 7: Commit**

```bash
git add src/api/v1/admin/tenants/ src/plugins/manifest/built-in-manifests.ts
git commit -m "feat(admin): add AdminTenantsService"
```

---

### Task 6: AdminTenantsController

**Files:**
- Create: `src/api/v1/admin/tenants/admin-tenants.controller.ts`

**Step 1: Implement controller**

Create `src/api/v1/admin/tenants/admin-tenants.controller.ts`:

```typescript
import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query,
  HttpCode, UseGuards,
} from '@nestjs/common';
import { SuperAdminGuard } from '../guards/super-admin.guard';
import { AdminTenantsService } from './admin-tenants.service';

@Controller('api/v1/admin/tenants')
@UseGuards(SuperAdminGuard)
export class AdminTenantsController {
  constructor(private readonly tenantsService: AdminTenantsService) {}

  @Get()
  list(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('search') search?: string,
  ) {
    return this.tenantsService.list({
      page: Number(page),
      limit: Number(limit),
      search,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tenantsService.findOne(id);
  }

  @Post()
  create(@Body() body: { name: string; subdomain: string; plan: string }) {
    return this.tenantsService.create(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: { name?: string; status?: string; plan?: string },
  ) {
    return this.tenantsService.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async softDelete(@Param('id') id: string) {
    await this.tenantsService.softDelete(id);
  }

  @Get(':id/plugins')
  getPlugins(@Param('id') id: string) {
    return this.tenantsService.getPlugins(id);
  }

  @Patch(':tenantId/plugins/:pluginId')
  togglePlugin(
    @Param('tenantId') tenantId: string,
    @Param('pluginId') pluginId: string,
    @Body() body: { enabled: boolean },
  ) {
    return this.tenantsService.togglePlugin(tenantId, pluginId, body.enabled);
  }
}
```

**Step 2: Commit**

```bash
git add src/api/v1/admin/tenants/admin-tenants.controller.ts
git commit -m "feat(admin): add AdminTenantsController"
```

---

### Task 7: AdminMetricsController + Service

**Files:**
- Create: `src/api/v1/admin/metrics/admin-metrics.service.ts`
- Create: `src/api/v1/admin/metrics/admin-metrics.controller.ts`

**Step 1: Implement AdminMetricsService**

Create `src/api/v1/admin/metrics/admin-metrics.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { PoolRegistry } from '../../../../dal/pool/PoolRegistry';

@Injectable()
export class AdminMetricsService {
  constructor(private readonly poolRegistry: PoolRegistry) {}

  async getSummary() {
    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      const res = await client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM tenants WHERE is_active = true AND subdomain != 'system'`,
      );
      const activeTenantsCount = Number(res.rows[0].count);

      const poolStats = this.poolRegistry.getSharedPoolStats();
      const dbPoolUtilization = poolStats
        ? Math.round((poolStats.totalCount - poolStats.idleCount) / poolStats.totalCount * 100) / 100
        : 0;

      return {
        activeTenantsCount,
        requestsPerMinute: 0,      // requires Prometheus — mock for dev
        avgResponseTimeMs: 0,      // requires Prometheus — mock for dev
        errorRate: 0,              // requires Prometheus — mock for dev
        dbPoolUtilization,
        cacheHitRate: 0,           // requires Redis INFO — mock for dev
      };
    } finally {
      client.release();
    }
  }
}
```

**Step 2: Check PoolRegistry.getSharedPoolStats**

In `src/dal/pool/PoolRegistry.ts`, check if `getSharedPoolStats()` exists. If not, check what methods are available for pool statistics and update accordingly. If no stats method exists, set `dbPoolUtilization: 0` directly.

**Step 3: Implement AdminMetricsController**

Create `src/api/v1/admin/metrics/admin-metrics.controller.ts`:

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { SuperAdminGuard } from '../guards/super-admin.guard';
import { AdminMetricsService } from './admin-metrics.service';

@Controller('api/v1/admin/metrics')
@UseGuards(SuperAdminGuard)
export class AdminMetricsController {
  constructor(private readonly metricsService: AdminMetricsService) {}

  @Get('summary')
  getSummary() {
    return this.metricsService.getSummary();
  }
}
```

**Step 4: Commit**

```bash
git add src/api/v1/admin/metrics/
git commit -m "feat(admin): add AdminMetricsController and service"
```

---

### Task 8: AdminModule + wire up

**Files:**
- Create: `src/api/v1/admin/admin.module.ts`
- Modify: `src/api/v1/api-v1.module.ts`

**Step 1: Create AdminModule**

Create `src/api/v1/admin/admin.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { config } from '../../../config/env';
import { SuperAdminGuard } from './guards/super-admin.guard';
import { AdminAuthController } from './admin-auth/admin-auth.controller';
import { AdminAuthService } from './admin-auth/admin-auth.service';
import { AdminTenantsController } from './tenants/admin-tenants.controller';
import { AdminTenantsService } from './tenants/admin-tenants.service';
import { AdminMetricsController } from './metrics/admin-metrics.controller';
import { AdminMetricsService } from './metrics/admin-metrics.service';

@Module({
  imports: [
    JwtModule.register({
      secret: config.JWT_SECRET_FALLBACK ?? 'dev-secret-change-me',
      signOptions: { expiresIn: '24h', algorithm: 'HS256' },
    }),
  ],
  controllers: [
    AdminAuthController,
    AdminTenantsController,
    AdminMetricsController,
  ],
  providers: [
    SuperAdminGuard,
    AdminAuthService,
    AdminTenantsService,
    AdminMetricsService,
  ],
})
export class AdminModule {}
```

**Step 2: Register AdminModule in ApiV1Module**

Modify `src/api/v1/api-v1.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ApiV1Controller } from './api-v1.controller';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [AuthModule, AdminModule],
  controllers: [ApiV1Controller],
})
export class ApiV1Module {}
```

**Step 3: Commit**

```bash
git add src/api/v1/admin/admin.module.ts src/api/v1/api-v1.module.ts
git commit -m "feat(admin): wire up AdminModule"
```

---

### Task 9: End-to-end smoke test

**Step 1: Restart backend**

```bash
cd backend && npm run start:dev
```
Expected: clean startup, no errors.

**Step 2: Test admin login**

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/v1/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@crm.dev","password":"admin123"}' | jq -r '.token')
echo "Token: $TOKEN"
```
Expected: JWT token printed.

**Step 3: Test tenants list**

```bash
curl -s http://localhost:3001/api/v1/admin/tenants \
  -H "Authorization: Bearer $TOKEN" | jq '{total: .total, first: .data[0].name}'
```
Expected: `{ "total": 3, "first": "Acme Corporation" }` (or similar)

**Step 4: Test metrics**

```bash
curl -s http://localhost:3001/api/v1/admin/metrics/summary \
  -H "Authorization: Bearer $TOKEN" | jq .
```
Expected: JSON with `activeTenantsCount: 3`

**Step 5: Test plugin toggle**

```bash
TENANT_ID=$(curl -s http://localhost:3001/api/v1/admin/tenants \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id')

curl -s -X PATCH "http://localhost:3001/api/v1/admin/tenants/$TENANT_ID/plugins/analytics" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled":true}' | jq .
```
Expected: `{ "pluginId": "analytics", "enabled": true }`

**Step 6: Open admin console in browser**

Open http://localhost:3000, login with `admin@crm.dev` / `admin123`.
Expected: Dashboard shows 3 tenants, metrics display.

**Step 7: Final commit**

```bash
git add -A
git commit -m "feat(admin): complete admin routes implementation"
```
