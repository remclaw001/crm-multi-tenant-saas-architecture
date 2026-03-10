# Auth Refresh & Logout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add stateful JWT invalidation: refresh tokens (opaque hex, DB-stored), logout (Redis JTI blacklist), and per-request blacklist check in JwtAuthGuard.

**Architecture:** Refresh tokens stored as SHA-256 hashes in a new `refresh_tokens` table (metadata pool). JTI blacklisting uses Redis with TTL = remaining token lifetime. `jti` is added to every JWT payload at sign time. DalModule exports a raw `REDIS_CLIENT` token used by both AuthService and JwtAuthGuard.

**Tech Stack:** NestJS, ioredis, pg (metadata pool via PoolRegistry), crypto (Node built-in), @nestjs/jwt JwtService already wired in AuthModule.

---

### Task 1: DB Migration — `refresh_tokens` table

**Files:**
- Create: `backend/src/db/migrations/20260309000005_refresh_tokens.ts`

**Step 1: Create the migration file**

```typescript
// backend/src/db/migrations/20260309000005_refresh_tokens.ts
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('refresh_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    // SHA-256 hex of the opaque token sent to the client (never store plaintext)
    t.string('token_hash', 64).notNullable().unique();
    t.uuid('user_id').notNullable();
    t.uuid('tenant_id').notNullable();
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('revoked_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // Primary lookup: hash → token record
  await knex.raw(
    'CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash)'
  );
  // Cleanup queries: find all active tokens for a user
  await knex.raw(
    'CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id, tenant_id) WHERE revoked_at IS NULL'
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('refresh_tokens');
}
```

**Step 2: Run migration**

```bash
cd backend && npm run db:migrate
```

Expected output: `Batch 5 run: 1 migrations`

**Step 3: Verify table exists**

```bash
cd backend && npm run db:status
```

Expected: all 5 migrations marked `Completed`.

**Step 4: Commit**

```bash
git add backend/src/db/migrations/20260309000005_refresh_tokens.ts
git commit -m "feat(auth): add refresh_tokens migration"
```

---

### Task 2: Expose `REDIS_CLIENT` from DalModule

AuthService and JwtAuthGuard both need raw Redis access (CacheManager requires TenantContext which is absent in auth flows).

**Files:**
- Modify: `backend/src/dal/dal.module.ts`

**Step 1: Add `REDIS_CLIENT` provider and export**

In `dal.module.ts`, add a second `Redis` instance alongside the one used by CacheManager:

```typescript
import Redis from 'ioredis';
import { Global, Module } from '@nestjs/common';
import { config } from '../config/env';
import { PoolRegistry } from './pool/PoolRegistry';
import { CacheManager } from './cache/CacheManager';
import { createKnex } from './interceptor/QueryInterceptor';

@Global()
@Module({
  providers: [
    {
      provide: PoolRegistry,
      useFactory: () => new PoolRegistry(),
    },
    {
      provide: CacheManager,
      useFactory: () => new CacheManager(new Redis(config.REDIS_URL)),
    },
    {
      provide: 'KNEX_INSTANCE',
      useFactory: () => createKnex(config.DATABASE_URL, config.DATABASE_POOL_MAX),
    },
    // Raw Redis client for auth (blacklist, refresh tokens) — no TenantContext needed
    {
      provide: 'REDIS_CLIENT',
      useFactory: () => new Redis(config.REDIS_URL),
    },
  ],
  exports: [PoolRegistry, CacheManager, 'KNEX_INSTANCE', 'REDIS_CLIENT'],
})
export class DalModule {}
```

**Step 2: Verify app still boots**

```bash
cd backend && npm run start:dev
```

Expected: No errors, `[NestApplication] Nest application successfully started`.

**Step 3: Commit**

```bash
git add backend/src/dal/dal.module.ts
git commit -m "feat(dal): expose REDIS_CLIENT token from DalModule"
```

---

### Task 3: Write failing tests for AuthService refresh & logout

**Files:**
- Create: `backend/src/api/v1/auth/__tests__/auth.service.test.ts`

**Step 1: Write the tests**

```typescript
// backend/src/api/v1/auth/__tests__/auth.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

// Hoisted mocks — must use vi.hoisted() for variables in vi.mock() factories
const mockPoolConnect = vi.hoisted(() => vi.fn());
const mockRedisGet = vi.hoisted(() => vi.fn());
const mockRedisSetex = vi.hoisted(() => vi.fn());

vi.mock('../../../dal/pool/PoolRegistry', () => ({
  PoolRegistry: vi.fn().mockImplementation(() => ({
    getMetadataPool: () => ({ connect: mockPoolConnect }),
  })),
}));

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    get: mockRedisGet,
    setex: mockRedisSetex,
  })),
}));

// Stub JwtService
const mockJwtSign = vi.hoisted(() => vi.fn().mockReturnValue('new.jwt.token'));
vi.mock('@nestjs/jwt', () => ({
  JwtService: vi.fn().mockImplementation(() => ({ sign: mockJwtSign })),
}));

// Stub PasswordService
const mockVerify = vi.hoisted(() => vi.fn());
vi.mock('../../../common/security/password.service', () => ({
  PasswordService: vi.fn().mockImplementation(() => ({ verify: mockVerify })),
}));

import { AuthService } from '../auth.service';
import { PoolRegistry } from '../../../dal/pool/PoolRegistry';
import { PasswordService } from '../../../common/security/password.service';
import { JwtService } from '@nestjs/jwt';

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    query: vi.fn(),
    release: vi.fn(),
    ...overrides,
  };
}

describe('AuthService.refresh', () => {
  let service: AuthService;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AuthService(
      new PoolRegistry() as any,
      new PasswordService() as any,
      new JwtService() as any,
      { get: mockRedisGet, setex: mockRedisSetex } as any,
    );
    client = makeClient();
    mockPoolConnect.mockResolvedValue(client);
  });

  it('throws 401 when refresh token not found in DB', async () => {
    client.query.mockResolvedValue({ rows: [] }); // no token row
    await expect(service.refresh('unknown-token')).rejects.toThrow(UnauthorizedException);
  });

  it('throws 401 when refresh token is expired', async () => {
    const past = new Date(Date.now() - 1000);
    client.query.mockResolvedValueOnce({
      rows: [{ id: 'rt-1', user_id: 'u1', tenant_id: 't1', expires_at: past }],
    });
    await expect(service.refresh('valid-but-expired')).rejects.toThrow(UnauthorizedException);
  });

  it('returns new token and rotates refresh token on success', async () => {
    const future = new Date(Date.now() + 86400_000);
    // First query: find refresh token
    client.query
      .mockResolvedValueOnce({ rows: [{ id: 'rt-1', user_id: 'u1', tenant_id: 't1', expires_at: future }] })
      // Second query: load user+roles
      .mockResolvedValueOnce({ rows: [{ id: 'u1', email: 'a@b.com', name: 'A', is_active: true, roles: ['admin'] }] })
      // Third: BEGIN
      .mockResolvedValueOnce(undefined)
      // Fourth: revoke old token
      .mockResolvedValueOnce(undefined)
      // Fifth: insert new token
      .mockResolvedValueOnce(undefined)
      // Sixth: COMMIT
      .mockResolvedValueOnce(undefined);

    const result = await service.refresh('good-token');
    expect(result.token).toBe('new.jwt.token');
    expect(result.refreshToken).toBeDefined();
    expect(result.refreshToken).toHaveLength(96); // 48 bytes → 96 hex chars
  });
});

describe('AuthService.logout', () => {
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisSetex.mockResolvedValue('OK');
    service = new AuthService(
      new PoolRegistry() as any,
      new PasswordService() as any,
      new JwtService() as any,
      { get: mockRedisGet, setex: mockRedisSetex } as any,
    );
  });

  it('adds JTI to Redis blacklist with remaining TTL', async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    await service.logout('jti-abc', futureExp);
    expect(mockRedisSetex).toHaveBeenCalledWith(
      'auth:blacklist:jti-abc',
      expect.any(Number),
      '1',
    );
    const ttlArg = mockRedisSetex.mock.calls[0][1] as number;
    expect(ttlArg).toBeGreaterThan(0);
    expect(ttlArg).toBeLessThanOrEqual(3600);
  });

  it('skips Redis call when token is already expired', async () => {
    const pastExp = Math.floor(Date.now() / 1000) - 10;
    await service.logout('jti-old', pastExp);
    expect(mockRedisSetex).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run tests — expect FAIL (AuthService doesn't have refresh/logout yet)**

```bash
cd backend && npx vitest src/api/v1/auth/__tests__/auth.service.test.ts
```

Expected: Tests fail with errors about missing methods.

---

### Task 4: Implement `refresh()` and `logout()` in AuthService + update constructor

**Files:**
- Modify: `backend/src/api/v1/auth/auth.service.ts`

**Step 1: Replace auth.service.ts with full implementation**

```typescript
// backend/src/api/v1/auth/auth.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { randomUUID } from 'crypto';
import type { Redis } from 'ioredis';
import { PoolRegistry } from '../../../dal/pool/PoolRegistry';
import { PasswordService } from '../../../common/security/password.service';
import type { LoginDto } from './dto/login.dto';

const REFRESH_TOKEN_TTL_DAYS = 7;
const BLACKLIST_KEY_PREFIX = 'auth:blacklist:';

@Injectable()
export class AuthService {
  constructor(
    private readonly poolRegistry: PoolRegistry,
    private readonly passwordService: PasswordService,
    private readonly jwtService: JwtService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  async login(dto: LoginDto) {
    const pool = this.poolRegistry.getMetadataPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const tenantRes = await client.query<{
        id: string; subdomain: string; name: string; tier: string;
      }>(
        `SELECT id, subdomain, name, tier FROM tenants
         WHERE subdomain = $1 AND is_active = true LIMIT 1`,
        [dto.tenantSlug],
      );
      const tenant = tenantRes.rows[0];
      if (!tenant) throw new UnauthorizedException('Tenant not found or inactive');

      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);

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

      await client.query('COMMIT');

      const DUMMY_HASH = '$2b$12$invalidhashusedtoblindtimingXXXXXXXXXXXXXXXXXXXXXXX';
      const hashToCompare = user?.password_hash ?? DUMMY_HASH;
      const valid = await this.passwordService.verify(dto.password, hashToCompare);

      if (!user || !user.is_active || !valid) {
        throw new UnauthorizedException('Invalid credentials');
      }

      const jti = randomUUID();
      const token = this.jwtService.sign({
        sub: user.id,
        tenant_id: tenant.id,
        email: user.email,
        roles: user.roles,
        jti,
      });

      const refreshToken = await this.issueRefreshToken(client, user.id, tenant.id);

      return {
        token,
        refreshToken,
        user: { id: user.id, name: user.name, email: user.email, roles: user.roles },
        tenant: { id: tenant.id, subdomain: tenant.subdomain, name: tenant.name, tier: tenant.tier },
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async refresh(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    const pool = this.poolRegistry.getMetadataPool();
    const client = await pool.connect();

    try {
      // 1. Look up the token
      const tokenRes = await client.query<{
        id: string; user_id: string; tenant_id: string; expires_at: Date;
      }>(
        `SELECT id, user_id, tenant_id, expires_at FROM refresh_tokens
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [tokenHash],
      );
      const tokenRow = tokenRes.rows[0];
      if (!tokenRow) throw new UnauthorizedException('Invalid refresh token');
      if (tokenRow.expires_at < new Date()) {
        throw new UnauthorizedException('Refresh token expired');
      }

      // 2. Load user + roles
      const userRes = await client.query<{
        id: string; email: string; name: string; is_active: boolean; roles: string[];
      }>(
        `SELECT u.id, u.email, u.name, u.is_active,
                COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = $2
         LEFT JOIN roles r ON r.id = ur.role_id AND r.tenant_id = $2
         WHERE u.id = $1
         GROUP BY u.id`,
        [tokenRow.user_id, tokenRow.tenant_id],
      );
      const user = userRes.rows[0];
      if (!user || !user.is_active) throw new UnauthorizedException('User inactive');

      // 3. Rotate: revoke old, issue new (in a transaction)
      await client.query('BEGIN');
      await client.query(
        `UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`,
        [tokenRow.id],
      );
      const newRefreshToken = await this.issueRefreshToken(client, user.id, tokenRow.tenant_id);
      await client.query('COMMIT');

      // 4. Issue new JWT
      const jti = randomUUID();
      const token = this.jwtService.sign({
        sub: user.id,
        tenant_id: tokenRow.tenant_id,
        email: user.email,
        roles: user.roles,
        jti,
      });

      return { token, refreshToken: newRefreshToken };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async logout(jti: string, exp: number): Promise<void> {
    const remainingTtl = exp - Math.floor(Date.now() / 1000);
    if (remainingTtl > 0) {
      await this.redis.setex(`${BLACKLIST_KEY_PREFIX}${jti}`, remainingTtl, '1');
    }
  }

  // ── Private helpers ────────────────────────────────────────

  private async issueRefreshToken(
    client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    userId: string,
    tenantId: string,
  ): Promise<string> {
    const token = randomBytes(48).toString('hex');
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86400_000);

    await client.query(
      `INSERT INTO refresh_tokens (token_hash, user_id, tenant_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [tokenHash, userId, tenantId, expiresAt],
    );

    return token;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
```

Note: Add `import { Inject } from '@nestjs/common';` at the top.

**Step 2: Run the tests**

```bash
cd backend && npx vitest src/api/v1/auth/__tests__/auth.service.test.ts
```

Expected: All tests pass.

**Step 3: Commit**

```bash
git add backend/src/api/v1/auth/auth.service.ts \
        backend/src/api/v1/auth/__tests__/auth.service.test.ts
git commit -m "feat(auth): implement refresh token rotation and logout JTI blacklist"
```

---

### Task 5: Add DTOs and update AuthModule

**Files:**
- Create: `backend/src/api/v1/auth/dto/refresh.dto.ts`
- Modify: `backend/src/api/v1/auth/auth.module.ts`

**Step 1: Create RefreshDto**

```typescript
// backend/src/api/v1/auth/dto/refresh.dto.ts
import { IsString, IsNotEmpty, Length } from 'class-validator';

export class RefreshDto {
  @IsString()
  @IsNotEmpty()
  @Length(96, 96) // 48 bytes → 96 hex chars
  refreshToken!: string;
}
```

**Step 2: Update AuthModule to inject REDIS_CLIENT**

```typescript
// backend/src/api/v1/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { config } from '../../../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [
    JwtModule.register({
      secret: config.JWT_SECRET_FALLBACK ?? (() => {
        throw new Error('JWT_SECRET_FALLBACK is required. Set it in .env (min 32 chars).');
      })(),
      signOptions: { expiresIn: '24h', algorithm: 'HS256' },
    }),
  ],
  controllers: [AuthController],
  // REDIS_CLIENT and PoolRegistry come from @Global() DalModule — no need to import
  providers: [AuthService],
})
export class AuthModule {}
```

Note: `REDIS_CLIENT` is available globally via `@Global() DalModule` — AuthModule does not need to import DalModule.

**Step 3: Commit**

```bash
git add backend/src/api/v1/auth/dto/refresh.dto.ts \
        backend/src/api/v1/auth/auth.module.ts
git commit -m "feat(auth): add RefreshDto, wire REDIS_CLIENT into AuthModule"
```

---

### Task 6: Add refresh and logout endpoints to AuthController

**Files:**
- Modify: `backend/src/api/v1/auth/auth.controller.ts`
- Modify: `backend/src/gateway/dto/jwt-claims.dto.ts` (add `jti?` field if not present)

**Step 1: Check jwt-claims.dto.ts**

Read `backend/src/gateway/dto/jwt-claims.dto.ts`. If `jti` is missing, add it:

```typescript
export interface JwtClaims {
  sub: string;
  tenant_id: string;
  roles: string[];
  email?: string;
  jti?: string;   // ← add this
  iat?: number;
  exp?: number;
}
```

**Step 2: Update AuthController**

```typescript
// backend/src/api/v1/auth/auth.controller.ts
import { Controller, Post, Body, HttpCode, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { Public } from '../../../gateway/decorators/public.decorator';
import { CurrentUser } from '../../../gateway/decorators/current-tenant.decorator';
import type { JwtClaims } from '../../../gateway/dto/jwt-claims.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @Public()
  login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  @Post('refresh')
  @HttpCode(200)
  @Public()
  refresh(@Body() body: RefreshDto) {
    return this.authService.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: JwtClaims) {
    if (user.jti && user.exp) {
      await this.authService.logout(user.jti, user.exp);
    }
  }
}
```

**Step 3: Verify build**

```bash
cd backend && npm run build 2>&1 | tail -20
```

Expected: Exits with code 0, no TS errors.

**Step 4: Commit**

```bash
git add backend/src/api/v1/auth/auth.controller.ts \
        backend/src/gateway/dto/jwt-claims.dto.ts
git commit -m "feat(auth): add POST /auth/refresh and POST /auth/logout endpoints"
```

---

### Task 7: Add JTI blacklist check to JwtAuthGuard

**Files:**
- Modify: `backend/src/gateway/guards/jwt-auth.guard.ts`

**Step 1: Write failing test**

```typescript
// backend/src/gateway/guards/__tests__/jwt-auth.guard.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

const mockRedisGet = vi.hoisted(() => vi.fn());
vi.mock('ioredis', () => ({ default: vi.fn() }));

import { JwtAuthGuard } from '../jwt-auth.guard';

function makeContext(user: unknown, resolvedTenant?: { id: string }) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user, resolvedTenant }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard.handleRequest — blacklist check', () => {
  let guard: JwtAuthGuard;
  const redis = { get: mockRedisGet };

  beforeEach(() => {
    vi.clearAllMocks();
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector;
    guard = new JwtAuthGuard(reflector, redis as any);
  });

  it('passes when jti is not in blacklist', async () => {
    mockRedisGet.mockResolvedValue(null);
    const ctx = makeContext({ sub: 'u1', tenant_id: 't1', roles: [], jti: 'jti-ok', exp: 9999999999 });
    const result = await (guard as any).handleRequest(null, { sub: 'u1', tenant_id: 't1', roles: [], jti: 'jti-ok', exp: 9999999999 }, undefined, ctx);
    expect(result.sub).toBe('u1');
  });

  it('throws 401 when jti is in Redis blacklist', async () => {
    mockRedisGet.mockResolvedValue('1');
    const claims = { sub: 'u1', tenant_id: 't1', roles: [], jti: 'jti-revoked', exp: 9999999999 };
    const ctx = makeContext(claims);
    await expect(
      (guard as any).handleRequest(null, claims, undefined, ctx)
    ).rejects.toThrow(UnauthorizedException);
  });

  it('skips blacklist check when jti is absent', async () => {
    const claims = { sub: 'u1', tenant_id: 't1', roles: [] }; // no jti
    const ctx = makeContext(claims);
    const result = await (guard as any).handleRequest(null, claims, undefined, ctx);
    expect(mockRedisGet).not.toHaveBeenCalled();
    expect(result.sub).toBe('u1');
  });
});
```

**Step 2: Run test — expect FAIL**

```bash
cd backend && npx vitest src/gateway/guards/__tests__/jwt-auth.guard.test.ts
```

**Step 3: Update JwtAuthGuard to accept Redis and check blacklist**

```typescript
// backend/src/gateway/guards/jwt-auth.guard.ts
import {
  Injectable, ExecutionContext,
  UnauthorizedException, ForbiddenException, Inject,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import type { Redis } from 'ioredis';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { JwtClaims } from '../dto/jwt-claims.dto';
import type { ResolvedTenant } from '../dto/resolved-tenant.dto';

const BLACKLIST_KEY_PREFIX = 'auth:blacklist:';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {
    super();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  async handleRequest<T = JwtClaims>(
    err: Error | null,
    user: T | false,
    info: { message?: string } | undefined,
    context: ExecutionContext,
  ): Promise<T> {
    if (err || !user) {
      const message = err?.message ?? info?.message ?? 'Missing or invalid authentication token';
      throw new UnauthorizedException(message);
    }

    const req = context
      .switchToHttp()
      .getRequest<Request & { resolvedTenant?: ResolvedTenant }>();

    const claims = user as unknown as JwtClaims;

    // Tenant cross-validation
    const resolvedTenant = req.resolvedTenant;
    if (resolvedTenant && claims.tenant_id !== resolvedTenant.id) {
      throw new ForbiddenException(
        `JWT tenant mismatch: token belongs to tenant ${claims.tenant_id}, ` +
        `but request targets tenant ${resolvedTenant.id}`
      );
    }

    // JTI blacklist check (only when jti present — old tokens without jti still work)
    if (claims.jti) {
      const revoked = await this.redis.get(`${BLACKLIST_KEY_PREFIX}${claims.jti}`);
      if (revoked) {
        throw new UnauthorizedException('Token has been revoked');
      }
    }

    return user;
  }
}
```

Note: `handleRequest` is now `async` — NestJS/Passport supports async `handleRequest`.

**Step 4: Run tests**

```bash
cd backend && npx vitest src/gateway/guards/__tests__/jwt-auth.guard.test.ts
```

Expected: All pass.

**Step 5: Run full unit test suite**

```bash
cd backend && npm test
```

Expected: All existing tests still pass.

**Step 6: Commit**

```bash
git add backend/src/gateway/guards/jwt-auth.guard.ts \
        backend/src/gateway/guards/__tests__/jwt-auth.guard.test.ts
git commit -m "feat(auth): add Redis JTI blacklist check to JwtAuthGuard"
```

---

### Task 8: Smoke test the full flow

**Step 1: Start the app**

```bash
cd backend && npm run start:dev
```

**Step 2: Login and get token + refreshToken**

```bash
curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"tenantSlug":"acme","email":"admin@acme.example.com","password":"password123"}' | jq .
```

Expected: Response with `token`, `refreshToken` (96-char hex), `user`, `tenant`.

**Step 3: Use the token on a protected endpoint**

```bash
TOKEN="<token from step 2>"
curl -s http://localhost:3000/api/v1/acme/ping \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant-ID: <tenant id from step 2>" | jq .
```

Expected: 200 with tenant/user info.

**Step 4: Logout**

```bash
curl -s -X POST http://localhost:3000/auth/logout \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant-ID: <tenant id>" \
  -w "\nHTTP %{http_code}\n"
```

Expected: HTTP 204.

**Step 5: Attempt to use the same token after logout**

```bash
curl -s http://localhost:3000/api/v1/acme/ping \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant-ID: <tenant id>" | jq .
```

Expected: 401 `Token has been revoked`.

**Step 6: Refresh to get new token**

```bash
REFRESH="<refreshToken from step 2>"
curl -s -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$REFRESH\"}" | jq .
```

Expected: 200 with new `token` and new `refreshToken`.

---

### Task 9: Remove warning from HTML docs

**Files:**
- Modify: `docs/crm-auth-flow.html`

**Step 1: Remove the amber warning note from the Refresh panel**

In `docs/crm-auth-flow.html`, find and delete both `<div class="nt am" data-lang="vi">` and `<div class="nt am" data-lang="en">` in `<div id="p-refresh">`. Update the diagram blocks to reflect the completed implementation instead of "not yet implemented."

Also remove the `⚠` from the nav tab button.

**Step 2: Verify the HTML looks correct in browser**

Open `docs/crm-auth-flow.html` in browser and navigate to the "Refresh & Revoke" tab. Toggle language. Confirm no amber warning appears.

**Step 3: Commit**

```bash
git add docs/crm-auth-flow.html
git commit -m "docs: update auth-flow doc — refresh/logout now implemented"
```

---

### Task 10: Final commit

```bash
git add -A
git status  # verify no untracked files missed
git commit -m "feat(auth): complete refresh token + logout + JTI blacklist implementation" --allow-empty
```
