# Admin Tenant User Management — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add CRUD + disable/enable for users (admin/manager roles) under each tenant in the admin console.

**Architecture:** New `AdminUsersService` + `AdminUsersController` added to the existing `AdminModule`. Uses raw metadata pg client with `SET LOCAL app.tenant_id` to bypass FORCE RLS on `users`/`roles`/`user_roles`. Frontend adds `TenantUsersSection` inline on `TenantDetailPage` with three modals.

**Tech Stack:** NestJS (backend), Next.js 15 + TanStack Query + Tailwind (frontend), bcrypt via `PasswordService`, raw pg client for RLS bypass.

---

## Task 1: Backend — `AdminUsersService`

**Files:**
- Create: `backend/src/api/v1/admin/tenants/admin-users.service.ts`
- Create: `backend/src/api/v1/admin/tenants/__tests__/admin-users.service.test.ts`

**Background:** The `users`, `roles`, `user_roles` tables all have `FORCE ROW LEVEL SECURITY`. The metadata pool returns a raw `pg.PoolClient`. To satisfy the RLS policy (`tenant_id = current_setting('app.tenant_id', true)::uuid`), every query block must run inside a transaction with `SET LOCAL app.tenant_id = '<id>'` first. `PasswordService` is `@Global()` (from `SecurityModule`) so inject it directly.

**Step 1: Write the failing tests**

Create `backend/src/api/v1/admin/tenants/__tests__/admin-users.service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';

const mockQuery = vi.hoisted(() => vi.fn());
const mockRelease = vi.hoisted(() => vi.fn());
const mockAcquire = vi.hoisted(() => vi.fn());
const mockHash = vi.hoisted(() => vi.fn().mockResolvedValue('hashed-pw'));

vi.mock('../../../../dal/pool/PoolRegistry', () => ({
  PoolRegistry: vi.fn().mockImplementation(() => ({
    acquireMetadataConnection: mockAcquire,
  })),
}));

vi.mock('../../../../common/security/password.service', () => ({
  PasswordService: vi.fn().mockImplementation(() => ({
    hash: mockHash,
  })),
}));

import { AdminUsersService } from '../admin-users.service';
import { PoolRegistry } from '../../../../dal/pool/PoolRegistry';
import { PasswordService } from '../../../../common/security/password.service';

const TENANT_ID = 'tenant-uuid';
const USER_ROW = {
  id: 'user-uuid', name: 'Alice', email: 'alice@example.com',
  is_active: true, created_at: new Date().toISOString(), role: 'admin',
};

describe('AdminUsersService', () => {
  let service: AdminUsersService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAcquire.mockResolvedValue({ query: mockQuery, release: mockRelease });
    service = new AdminUsersService(
      new (PoolRegistry as any)(),
      new (PasswordService as any)(),
    );
  });

  describe('listUsers', () => {
    it('returns users with roles for a tenant', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [USER_ROW] }); // SET LOCAL
      mockQuery.mockResolvedValueOnce({ rows: [USER_ROW] }); // seed roles
      mockQuery.mockResolvedValueOnce({ rows: [USER_ROW] }); // SELECT users

      const result = await service.listUsers(TENANT_ID);
      expect(result[0].email).toBe('alice@example.com');
      expect(result[0].role).toBe('admin');
    });
  });

  describe('createUser', () => {
    it('hashes password and inserts user with role', async () => {
      // SET LOCAL, seed roles, INSERT user, find role, INSERT user_role
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [USER_ROW] })
        .mockResolvedValueOnce({ rows: [{ id: 'role-uuid' }] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await service.createUser(TENANT_ID, {
        name: 'Alice', email: 'alice@example.com', password: 'pw', role: 'admin',
      });
      expect(mockHash).toHaveBeenCalledWith('pw');
      expect(result.email).toBe('alice@example.com');
    });

    it('throws ConflictException on duplicate email', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce({ code: '23505' });

      await expect(
        service.createUser(TENANT_ID, { name: 'A', email: 'a@b.com', password: 'pw', role: 'admin' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateUser', () => {
    it('updates name and email', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })          // SET LOCAL
        .mockResolvedValueOnce({ rows: [USER_ROW] }); // UPDATE

      const result = await service.updateUser(TENANT_ID, 'user-uuid', { name: 'Bob' });
      expect(result.id).toBe('user-uuid');
    });

    it('throws NotFoundException when user not found', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // SET LOCAL
        .mockResolvedValueOnce({ rows: [] }); // UPDATE returns nothing

      await expect(
        service.updateUser(TENANT_ID, 'bad-id', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('setActive', () => {
    it('sets is_active on the user', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ...USER_ROW, is_active: false }] });

      const result = await service.setActive(TENANT_ID, 'user-uuid', false);
      expect(result.is_active).toBe(false);
    });
  });

  describe('deleteUser', () => {
    it('hard deletes the user', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'user-uuid' }] });

      await service.deleteUser(TENANT_ID, 'user-uuid');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM users'),
        expect.any(Array),
      );
    });

    it('throws NotFoundException when user not found', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(service.deleteUser(TENANT_ID, 'bad-id')).rejects.toThrow(NotFoundException);
    });
  });
});
```

**Step 2: Run tests to confirm they fail**

```bash
cd backend
npx vitest src/api/v1/admin/tenants/__tests__/admin-users.service.test.ts
```
Expected: FAIL — "Cannot find module '../admin-users.service'"

**Step 3: Implement `AdminUsersService`**

Create `backend/src/api/v1/admin/tenants/admin-users.service.ts`:

```typescript
import {
  Injectable, NotFoundException, ConflictException, BadRequestException,
} from '@nestjs/common';
import { PoolRegistry } from '../../../../dal/pool/PoolRegistry';
import { PasswordService } from '../../../../common/security/password.service';

export interface TenantUserRow {
  id: string; name: string; email: string;
  is_active: boolean; created_at: string; role: string | null;
}

function rowToUser(row: TenantUserRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: (row.role ?? null) as 'admin' | 'manager' | null,
    is_active: row.is_active,
    created_at: row.created_at,
  };
}

const VALID_ROLES = ['admin', 'manager'] as const;
type RoleName = typeof VALID_ROLES[number];

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly poolRegistry: PoolRegistry,
    private readonly passwordService: PasswordService,
  ) {}

  // Seed admin + manager roles for the tenant if they don't exist yet.
  // Must be called AFTER SET LOCAL app.tenant_id is in effect.
  private async seedRoles(client: { query: Function }, tenantId: string): Promise<void> {
    await client.query(
      `INSERT INTO roles (tenant_id, name, description)
       VALUES ($1, 'admin', 'Administrator'), ($1, 'manager', 'Manager')
       ON CONFLICT (tenant_id, name) DO NOTHING`,
      [tenantId],
    );
  }

  // Wrap fn in a transaction with SET LOCAL app.tenant_id to satisfy FORCE RLS.
  private async withTenant<T>(tenantId: string, fn: (client: { query: Function }) => Promise<T>): Promise<T> {
    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async listUsers(tenantId: string) {
    return this.withTenant(tenantId, async (client) => {
      await this.seedRoles(client, tenantId);
      const res = await client.query<TenantUserRow>(
        `SELECT u.id, u.name, u.email, u.is_active, u.created_at,
                r.name AS role
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
         LEFT JOIN roles r ON r.id = ur.role_id
         WHERE u.tenant_id = $1
         ORDER BY u.created_at DESC`,
        [tenantId],
      );
      return res.rows.map(rowToUser);
    });
  }

  async createUser(tenantId: string, input: {
    name: string; email: string; password: string; role: RoleName;
  }) {
    if (!VALID_ROLES.includes(input.role)) {
      throw new BadRequestException(`Invalid role "${input.role}"`);
    }
    const passwordHash = await this.passwordService.hash(input.password);

    return this.withTenant(tenantId, async (client) => {
      await this.seedRoles(client, tenantId);

      let userRow: TenantUserRow;
      try {
        const res = await client.query<TenantUserRow>(
          `INSERT INTO users (tenant_id, name, email, password_hash)
           VALUES ($1, $2, $3, $4)
           RETURNING id, name, email, is_active, created_at`,
          [tenantId, input.name, input.email, passwordHash],
        );
        userRow = { ...res.rows[0], role: input.role };
      } catch (err: unknown) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictException(`Email "${input.email}" already exists in this tenant`);
        }
        throw err;
      }

      const roleRes = await client.query<{ id: string }>(
        `SELECT id FROM roles WHERE tenant_id = $1 AND name = $2`,
        [tenantId, input.role],
      );
      await client.query(
        `INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3)`,
        [userRow.id, roleRes.rows[0].id, tenantId],
      );

      return rowToUser(userRow);
    });
  }

  async updateUser(tenantId: string, userId: string, input: {
    name?: string; email?: string; role?: RoleName; password?: string;
  }) {
    if (input.role && !VALID_ROLES.includes(input.role)) {
      throw new BadRequestException(`Invalid role "${input.role}"`);
    }

    const passwordHash = input.password
      ? await this.passwordService.hash(input.password)
      : undefined;

    return this.withTenant(tenantId, async (client) => {
      // Build dynamic SET clause for user fields
      const sets: string[] = [];
      const args: unknown[] = [tenantId, userId];
      if (input.name)         { args.push(input.name);         sets.push(`name = $${args.length}`); }
      if (input.email)        { args.push(input.email);        sets.push(`email = $${args.length}`); }
      if (passwordHash)       { args.push(passwordHash);       sets.push(`password_hash = $${args.length}`); }

      let userRow: TenantUserRow | undefined;

      if (sets.length > 0) {
        const res = await client.query<TenantUserRow>(
          `UPDATE users SET ${sets.join(', ')}, updated_at = NOW()
           WHERE tenant_id = $1 AND id = $2
           RETURNING id, name, email, is_active, created_at`,
          args,
        );
        if (!res.rows[0]) throw new NotFoundException(`User not found: ${userId}`);
        userRow = res.rows[0];
      } else {
        const res = await client.query<TenantUserRow>(
          `SELECT id, name, email, is_active, created_at FROM users WHERE tenant_id = $1 AND id = $2`,
          [tenantId, userId],
        );
        if (!res.rows[0]) throw new NotFoundException(`User not found: ${userId}`);
        userRow = res.rows[0];
      }

      if (input.role) {
        await this.seedRoles(client, tenantId);
        const roleRes = await client.query<{ id: string }>(
          `SELECT id FROM roles WHERE tenant_id = $1 AND name = $2`,
          [tenantId, input.role],
        );
        // Upsert: delete existing role assignment then re-insert
        await client.query(
          `DELETE FROM user_roles WHERE user_id = $1 AND tenant_id = $2`,
          [userId, tenantId],
        );
        await client.query(
          `INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3)`,
          [userId, roleRes.rows[0].id, tenantId],
        );
        userRow = { ...userRow, role: input.role };
      } else {
        // fetch current role for response
        const roleRes = await client.query<{ role: string | null }>(
          `SELECT r.name AS role FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id
           WHERE ur.user_id = $1 AND ur.tenant_id = $2`,
          [userId, tenantId],
        );
        userRow = { ...userRow, role: roleRes.rows[0]?.role ?? null };
      }

      return rowToUser(userRow);
    });
  }

  async setActive(tenantId: string, userId: string, isActive: boolean) {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query<TenantUserRow>(
        `UPDATE users SET is_active = $3, updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2
         RETURNING id, name, email, is_active, created_at`,
        [tenantId, userId, isActive],
      );
      if (!res.rows[0]) throw new NotFoundException(`User not found: ${userId}`);
      const roleRes = await client.query<{ role: string | null }>(
        `SELECT r.name AS role FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = $1 AND ur.tenant_id = $2`,
        [userId, tenantId],
      );
      return rowToUser({ ...res.rows[0], role: roleRes.rows[0]?.role ?? null });
    });
  }

  async deleteUser(tenantId: string, userId: string): Promise<void> {
    await this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `DELETE FROM users WHERE tenant_id = $1 AND id = $2 RETURNING id`,
        [tenantId, userId],
      );
      if (!res.rows[0]) throw new NotFoundException(`User not found: ${userId}`);
    });
  }
}
```

**Step 4: Run tests to confirm they pass**

```bash
cd backend
npx vitest src/api/v1/admin/tenants/__tests__/admin-users.service.test.ts
```
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add backend/src/api/v1/admin/tenants/admin-users.service.ts \
        backend/src/api/v1/admin/tenants/__tests__/admin-users.service.test.ts
git commit -m "feat(admin): add AdminUsersService with RLS-aware user CRUD"
```

---

## Task 2: Backend — `AdminUsersController` + wire into `AdminModule`

**Files:**
- Create: `backend/src/api/v1/admin/tenants/admin-users.controller.ts`
- Modify: `backend/src/api/v1/admin/admin.module.ts`

**Step 1: Create the controller**

Create `backend/src/api/v1/admin/tenants/admin-users.controller.ts`:

```typescript
import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, HttpCode, UseGuards,
} from '@nestjs/common';
import { SuperAdminGuard } from '../guards/super-admin.guard';
import { AdminUsersService } from './admin-users.service';

@Controller('api/v1/admin/tenants/:tenantId/users')
@UseGuards(SuperAdminGuard)
export class AdminUsersController {
  constructor(private readonly usersService: AdminUsersService) {}

  @Get()
  list(@Param('tenantId') tenantId: string) {
    return this.usersService.listUsers(tenantId);
  }

  @Post()
  create(
    @Param('tenantId') tenantId: string,
    @Body() body: { name: string; email: string; password: string; role: 'admin' | 'manager' },
  ) {
    return this.usersService.createUser(tenantId, body);
  }

  @Patch(':userId')
  update(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @Body() body: { name?: string; email?: string; role?: 'admin' | 'manager'; password?: string },
  ) {
    return this.usersService.updateUser(tenantId, userId, body);
  }

  @Patch(':userId/disable')
  @HttpCode(200)
  setActive(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @Body() body: { is_active: boolean },
  ) {
    return this.usersService.setActive(tenantId, userId, body.is_active);
  }

  @Delete(':userId')
  @HttpCode(204)
  async remove(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.usersService.deleteUser(tenantId, userId);
  }
}
```

**Step 2: Register in `AdminModule`**

Modify `backend/src/api/v1/admin/admin.module.ts` — add to `controllers` and `providers`:

```typescript
// Add import at top:
import { AdminUsersController } from './tenants/admin-users.controller';
import { AdminUsersService } from './tenants/admin-users.service';

// In @Module:
controllers: [
  AdminAuthController,
  AdminTenantsController,
  AdminUsersController,   // ← add
  AdminMetricsController,
],
providers: [
  SuperAdminGuard,
  AdminAuthService,
  AdminTenantsService,
  AdminUsersService,      // ← add
  AdminMetricsService,
],
```

**Step 3: Verify backend compiles**

```bash
cd backend && npm run build
```
Expected: no TypeScript errors.

**Step 4: Commit**

```bash
git add backend/src/api/v1/admin/tenants/admin-users.controller.ts \
        backend/src/api/v1/admin/admin.module.ts
git commit -m "feat(admin): add AdminUsersController and wire into AdminModule"
```

---

## Task 3: Frontend — types + API client

**Files:**
- Modify: `frontend/admin/src/types/api.types.ts`
- Modify: `frontend/admin/src/lib/api-client.ts`

**Step 1: Add types**

Append to `frontend/admin/src/types/api.types.ts`:

```typescript
export interface TenantUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'manager' | null;
  is_active: boolean;
  created_at: string;
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: 'admin' | 'manager';
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  role?: 'admin' | 'manager';
  password?: string;
}
```

**Step 2: Add API methods**

Add to the `adminApi` object in `frontend/admin/src/lib/api-client.ts` (after `deleteTenant`):

```typescript
// ─── Tenant Users ─────────────────────────────────────────────────────────────
getUsers(tenantId: string, token: string): Promise<TenantUser[]> {
  return request(`/api/v1/admin/tenants/${tenantId}/users`, { token });
},

createUser(tenantId: string, input: CreateUserInput, token: string): Promise<TenantUser> {
  return request(`/api/v1/admin/tenants/${tenantId}/users`, {
    method: 'POST',
    body: JSON.stringify(input),
    token,
  });
},

updateUser(tenantId: string, userId: string, input: UpdateUserInput, token: string): Promise<TenantUser> {
  return request(`/api/v1/admin/tenants/${tenantId}/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    token,
  });
},

setUserActive(tenantId: string, userId: string, isActive: boolean, token: string): Promise<TenantUser> {
  return request(`/api/v1/admin/tenants/${tenantId}/users/${userId}/disable`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: isActive }),
    token,
  });
},

deleteUser(tenantId: string, userId: string, token: string): Promise<void> {
  return request(`/api/v1/admin/tenants/${tenantId}/users/${userId}`, {
    method: 'DELETE',
    token,
  });
},
```

Remember to add the new types to the import at the top of `api-client.ts`:
```typescript
import type {
  Tenant, Plugin, MetricsSummary, PaginatedResponse,
  CreateTenantInput, UpdateTenantInput,
  AdminLoginResponse, ApiErrorBody,
  TenantUser, CreateUserInput, UpdateUserInput,  // ← add
} from '@/types/api.types';
```

**Step 3: Commit**

```bash
git add frontend/admin/src/types/api.types.ts \
        frontend/admin/src/lib/api-client.ts
git commit -m "feat(admin): add TenantUser types and API client methods"
```

---

## Task 4: Frontend — `AddUserModal`

**Files:**
- Create: `frontend/admin/src/components/add-user-modal.tsx`

**Step 1: Implement**

Create `frontend/admin/src/components/add-user-modal.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { adminApi } from '@/lib/api-client';
import type { TenantUser } from '@/types/api.types';

interface Props {
  tenantId: string;
  open: boolean;
  onClose: () => void;
}

interface FormState {
  name: string;
  email: string;
  password: string;
  role: 'admin' | 'manager';
}

interface FormErrors {
  name?: string;
  email?: string;
  password?: string;
}

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!form.name.trim()) errors.name = 'Name is required';
  if (!form.email.trim()) {
    errors.email = 'Email is required';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errors.email = 'Please enter a valid email';
  }
  if (!form.password) errors.password = 'Password is required';
  else if (form.password.length < 8) errors.password = 'Minimum 8 characters';
  return errors;
}

export function AddUserModal({ tenantId, open, onClose }: Props) {
  const token = useAuthStore((s) => s.token ?? '');
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>({ name: '', email: '', password: '', role: 'manager' });
  const [errors, setErrors] = useState<FormErrors>({});
  const [apiError, setApiError] = useState('');

  const mutation = useMutation({
    mutationFn: () => adminApi.createUser(tenantId, form, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-users', tenantId] });
      setForm({ name: '', email: '', password: '', role: 'manager' });
      setErrors({});
      setApiError('');
      onClose();
    },
    onError: (err: any) => {
      setApiError(err?.body?.detail ?? 'Failed to create user. Please try again.');
    },
  });

  function handleChange(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
      if (errors[field as keyof FormErrors]) setErrors((prev) => ({ ...prev, [field]: undefined }));
    };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError('');
    const validationErrors = validate(form);
    if (Object.keys(validationErrors).length > 0) { setErrors(validationErrors); return; }
    mutation.mutate();
  }

  function handleClose() {
    if (mutation.isPending) return;
    setForm({ name: '', email: '', password: '', role: 'manager' });
    setErrors({});
    setApiError('');
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-label="Add User"
        className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold">Add User</h2>
          <button type="button" onClick={handleClose} aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="space-y-4 px-6 py-5">
            {/* Name */}
            <div>
              <label htmlFor="user-name" className="mb-1.5 block text-sm font-medium">
                Name <span className="text-red-500">*</span>
              </label>
              <input id="user-name" type="text" value={form.name} onChange={handleChange('name')}
                className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${errors.name ? 'border-red-500' : 'border-border'}`}
              />
              {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
            </div>

            {/* Email */}
            <div>
              <label htmlFor="user-email" className="mb-1.5 block text-sm font-medium">
                Email <span className="text-red-500">*</span>
              </label>
              <input id="user-email" type="email" value={form.email} onChange={handleChange('email')}
                className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${errors.email ? 'border-red-500' : 'border-border'}`}
              />
              {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email}</p>}
            </div>

            {/* Role */}
            <div>
              <label htmlFor="user-role" className="mb-1.5 block text-sm font-medium">Role</label>
              <select id="user-role" value={form.role} onChange={handleChange('role')}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="user-password" className="mb-1.5 block text-sm font-medium">
                Password <span className="text-red-500">*</span>
              </label>
              <input id="user-password" type="password" value={form.password} onChange={handleChange('password')}
                className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${errors.password ? 'border-red-500' : 'border-border'}`}
              />
              {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password}</p>}
            </div>

            {apiError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{apiError}</p>}
          </div>

          <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
            <button type="button" onClick={handleClose} disabled={mutation.isPending}
              className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >Cancel</button>
            <button type="submit" disabled={mutation.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >{mutation.isPending ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/admin/src/components/add-user-modal.tsx
git commit -m "feat(admin): add AddUserModal component"
```

---

## Task 5: Frontend — `EditUserModal`

**Files:**
- Create: `frontend/admin/src/components/edit-user-modal.tsx`

**Step 1: Implement**

Create `frontend/admin/src/components/edit-user-modal.tsx`:

```typescript
'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { adminApi } from '@/lib/api-client';
import type { TenantUser } from '@/types/api.types';

interface Props {
  tenantId: string;
  user: TenantUser;
  onClose: () => void;
}

interface FormState {
  name: string;
  email: string;
  role: 'admin' | 'manager';
  resetPassword: boolean;
  password: string;
}

interface FormErrors {
  name?: string;
  email?: string;
  password?: string;
}

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!form.name.trim()) errors.name = 'Name is required';
  if (!form.email.trim()) {
    errors.email = 'Email is required';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errors.email = 'Please enter a valid email';
  }
  if (form.resetPassword) {
    if (!form.password) errors.password = 'Password is required';
    else if (form.password.length < 8) errors.password = 'Minimum 8 characters';
  }
  return errors;
}

export function EditUserModal({ tenantId, user, onClose }: Props) {
  const token = useAuthStore((s) => s.token ?? '');
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>({
    name: user.name,
    email: user.email,
    role: user.role ?? 'manager',
    resetPassword: false,
    password: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [apiError, setApiError] = useState('');

  useEffect(() => {
    setForm({ name: user.name, email: user.email, role: user.role ?? 'manager', resetPassword: false, password: '' });
    setErrors({});
    setApiError('');
  }, [user.id]);

  const mutation = useMutation({
    mutationFn: () =>
      adminApi.updateUser(tenantId, user.id, {
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        ...(form.resetPassword ? { password: form.password } : {}),
      }, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-users', tenantId] });
      onClose();
    },
    onError: (err: any) => {
      setApiError(err?.body?.detail ?? 'Failed to save. Please try again.');
    },
  });

  function handleChange(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value;
      setForm((prev) => ({ ...prev, [field]: value }));
      if (errors[field as keyof FormErrors]) setErrors((prev) => ({ ...prev, [field]: undefined }));
    };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError('');
    const validationErrors = validate(form);
    if (Object.keys(validationErrors).length > 0) { setErrors(validationErrors); return; }
    mutation.mutate();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget && !mutation.isPending) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-label="Edit User"
        className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold">Edit User</h2>
          <button type="button" onClick={onClose} disabled={mutation.isPending} aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="space-y-4 px-6 py-5">
            {/* Name */}
            <div>
              <label htmlFor="edit-user-name" className="mb-1.5 block text-sm font-medium">
                Name <span className="text-red-500">*</span>
              </label>
              <input id="edit-user-name" type="text" value={form.name} onChange={handleChange('name')}
                className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${errors.name ? 'border-red-500' : 'border-border'}`}
              />
              {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
            </div>

            {/* Email */}
            <div>
              <label htmlFor="edit-user-email" className="mb-1.5 block text-sm font-medium">
                Email <span className="text-red-500">*</span>
              </label>
              <input id="edit-user-email" type="email" value={form.email} onChange={handleChange('email')}
                className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${errors.email ? 'border-red-500' : 'border-border'}`}
              />
              {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email}</p>}
            </div>

            {/* Role */}
            <div>
              <label htmlFor="edit-user-role" className="mb-1.5 block text-sm font-medium">Role</label>
              <select id="edit-user-role" value={form.role} onChange={handleChange('role')}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            {/* Reset password toggle */}
            <div className="flex items-center gap-2">
              <input id="reset-password" type="checkbox" checked={form.resetPassword}
                onChange={handleChange('resetPassword')}
                className="h-4 w-4 rounded border-border"
              />
              <label htmlFor="reset-password" className="text-sm font-medium">Reset password</label>
            </div>

            {form.resetPassword && (
              <div>
                <label htmlFor="edit-user-password" className="mb-1.5 block text-sm font-medium">
                  New Password <span className="text-red-500">*</span>
                </label>
                <input id="edit-user-password" type="password" value={form.password} onChange={handleChange('password')}
                  className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${errors.password ? 'border-red-500' : 'border-border'}`}
                />
                {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password}</p>}
              </div>
            )}

            {apiError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{apiError}</p>}
          </div>

          <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
            <button type="button" onClick={onClose} disabled={mutation.isPending}
              className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >Cancel</button>
            <button type="submit" disabled={mutation.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >{mutation.isPending ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/admin/src/components/edit-user-modal.tsx
git commit -m "feat(admin): add EditUserModal component"
```

---

## Task 6: Frontend — `DeleteUserConfirmModal`

**Files:**
- Create: `frontend/admin/src/components/delete-user-confirm-modal.tsx`

**Step 1: Implement**

Create `frontend/admin/src/components/delete-user-confirm-modal.tsx`:

```typescript
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { adminApi } from '@/lib/api-client';
import type { TenantUser } from '@/types/api.types';

interface Props {
  tenantId: string;
  user: TenantUser;
  onClose: () => void;
}

export function DeleteUserConfirmModal({ tenantId, user, onClose }: Props) {
  const token = useAuthStore((s) => s.token ?? '');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => adminApi.deleteUser(tenantId, user.id, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-users', tenantId] });
      onClose();
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget && !mutation.isPending) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-label="Delete User"
        className="w-full max-w-sm rounded-lg border border-border bg-card shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold">Delete User</h2>
          <button type="button" onClick={onClose} disabled={mutation.isPending} aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5">
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <span className="font-medium text-foreground">{user.name}</span>?
            This action cannot be undone.
          </p>
          {mutation.isError && (
            <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
              Failed to delete user. Please try again.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <button type="button" onClick={onClose} disabled={mutation.isPending}
            className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >Cancel</button>
          <button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >{mutation.isPending ? 'Deleting…' : 'Delete'}</button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/admin/src/components/delete-user-confirm-modal.tsx
git commit -m "feat(admin): add DeleteUserConfirmModal component"
```

---

## Task 7: Frontend — `TenantUsersSection` + wire into `TenantDetailPage`

**Files:**
- Create: `frontend/admin/src/components/tenant-users-section.tsx`
- Modify: `frontend/admin/src/app/(dashboard)/tenants/[id]/page.tsx`

**Step 1: Implement `TenantUsersSection`**

Create `frontend/admin/src/components/tenant-users-section.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Users } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { adminApi } from '@/lib/api-client';
import { AddUserModal } from './add-user-modal';
import { EditUserModal } from './edit-user-modal';
import { DeleteUserConfirmModal } from './delete-user-confirm-modal';
import type { TenantUser } from '@/types/api.types';

const ROLE_BADGE: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-700',
  manager: 'bg-blue-100 text-blue-700',
};

export function TenantUsersSection({ tenantId }: { tenantId: string }) {
  const token = useAuthStore((s) => s.token ?? '');
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<TenantUser | null>(null);
  const [deletingUser, setDeletingUser] = useState<TenantUser | null>(null);

  const { data: users = [], isLoading, isError } = useQuery({
    queryKey: ['tenant-users', tenantId],
    queryFn: () => adminApi.getUsers(tenantId, token),
    enabled: Boolean(token),
  });

  const toggleActive = useMutation({
    mutationFn: ({ userId, isActive }: { userId: string; isActive: boolean }) =>
      adminApi.setUserActive(tenantId, userId, isActive, token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tenant-users', tenantId] }),
  });

  return (
    <div className="mt-4 rounded-lg border border-border bg-card">
      {/* Section header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Users</h2>
          {users.length > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {users.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" />
          Add User
        </button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">Loading…</div>
      ) : isError ? (
        <div className="flex h-24 items-center justify-center text-sm text-destructive">Failed to load users.</div>
      ) : users.length === 0 ? (
        <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">No users yet.</div>
      ) : (
        <div className="divide-y divide-border">
          {users.map((user) => (
            <div key={user.id} className="flex items-center justify-between px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              </div>
              <div className="ml-4 flex shrink-0 items-center gap-2">
                {user.role && (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_BADGE[user.role] ?? 'bg-muted text-muted-foreground'}`}>
                    {user.role}
                  </span>
                )}
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${user.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                  {user.is_active ? 'Active' : 'Disabled'}
                </span>
                {/* Disable toggle */}
                <button
                  onClick={() => toggleActive.mutate({ userId: user.id, isActive: !user.is_active })}
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  title={user.is_active ? 'Disable' : 'Enable'}
                >
                  {user.is_active ? 'Disable' : 'Enable'}
                </button>
                <button onClick={() => setEditingUser(user)} aria-label="Edit"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setDeletingUser(user)} aria-label="Delete"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AddUserModal tenantId={tenantId} open={addOpen} onClose={() => setAddOpen(false)} />
      {editingUser && <EditUserModal tenantId={tenantId} user={editingUser} onClose={() => setEditingUser(null)} />}
      {deletingUser && <DeleteUserConfirmModal tenantId={tenantId} user={deletingUser} onClose={() => setDeletingUser(null)} />}
    </div>
  );
}
```

**Step 2: Wire into `TenantDetailPage`**

In `frontend/admin/src/app/(dashboard)/tenants/[id]/page.tsx`, add the import and render the section below the Manage Plugins link:

```typescript
// Add import:
import { TenantUsersSection } from '@/components/tenant-users-section';

// After the Manage Plugins <Link> block, add:
<TenantUsersSection tenantId={id} />
```

**Step 3: Commit**

```bash
git add frontend/admin/src/components/tenant-users-section.tsx \
        frontend/admin/src/app/(dashboard)/tenants/[id]/page.tsx
git commit -m "feat(admin): add TenantUsersSection and wire into TenantDetailPage"
```
