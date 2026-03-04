# Web Frontend — Backend Alignment Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the web frontend so it talks to the real backend — correct API endpoints, data models, and a working auth flow.

**Architecture:** Add `POST /auth/login` to the backend using PoolRegistry's metadata pool (bypasses QueryInterceptor/RLS for the auth query). On the frontend, replace fabricated types/endpoints with ones that match the actual DB schema; swap Deals → Cases (support_cases), remove Tasks (no entity), and add a login page with an auth guard.

**Tech Stack:** NestJS + @nestjs/jwt + pg (raw pool) on backend; Next.js 15 + Zustand + TanStack Query on frontend.

---

## Key facts before you start

**Seeded credentials (after `npm run db:seed`):**
- Tenants: `acme` (standard), `globex` (standard), `initech` (vip)
- Users per tenant: `admin@{subdomain}.example.com`, `manager@…`, `agent@…`
- Password for all: `password123`

**Backend API response shapes:**
```
List:   { plugin: string, data: T[], count: number }
Single: { plugin: string, data: T }
```

**Actual backend routes:**
```
POST   /auth/login                                     ← NEW
GET    /api/v1/plugins                                 ← enabled plugins
GET    /api/v1/plugins/customer-data/customers
POST   /api/v1/plugins/customer-data/customers
GET/PUT/DELETE /api/v1/plugins/customer-data/customers/:id
GET    /api/v1/plugins/customer-care/cases
POST   /api/v1/plugins/customer-care/cases
GET/PUT/DELETE /api/v1/plugins/customer-care/cases/:id
```

**Backend Customer type:**
```typescript
{ id, tenant_id, name, email|null, phone|null, company|null, is_active, created_at, updated_at }
```

**Backend SupportCase type:**
```typescript
{ id, tenant_id, customer_id, customer_name|null, title, description|null,
  status: 'open'|'in_progress'|'resolved'|'closed',
  priority: 'low'|'medium'|'high', assigned_to|null, resolved_at|null, created_at, updated_at }
```

**JWT claims (HS256, signed with JWT_SECRET_FALLBACK):**
```typescript
{ sub: string, tenant_id: string, roles: string[], email?: string, iat, exp }
```

**How QueryInterceptor works:** It hooks `acquireConnection` on KNEX_INSTANCE, running `SET app.tenant_id = '<uuid>'` before each query to activate PostgreSQL RLS. When TenantContext is not set (no auth yet), it would set an empty value and break RLS queries. Auth service uses `PoolRegistry.getMetadataPool()` — a raw `pg.Pool` — to avoid this entirely.

---

## Task 1: Backend — Auth DTO + Service

**Files:**
- Create: `backend/src/api/v1/auth/dto/login.dto.ts`
- Create: `backend/src/api/v1/auth/auth.service.ts`

**Step 1: Create LoginDto**

```typescript
// backend/src/api/v1/auth/dto/login.dto.ts
export class LoginDto {
  tenantSlug!: string;
  email!: string;
  password!: string;
}
```

**Step 2: Create AuthService**

```typescript
// backend/src/api/v1/auth/auth.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PoolRegistry } from '../../../dal/pool/PoolRegistry';
import { PasswordService } from '../../../common/security/password.service';
import type { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly poolRegistry: PoolRegistry,
    private readonly passwordService: PasswordService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const pool = this.poolRegistry.getMetadataPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Find tenant by subdomain (tenants table has no RLS)
      const tenantRes = await client.query<{
        id: string; subdomain: string; name: string; tier: string;
      }>(
        `SELECT id, subdomain, name, tier FROM tenants
         WHERE subdomain = $1 AND is_active = true LIMIT 1`,
        [dto.tenantSlug],
      );
      const tenant = tenantRes.rows[0];
      if (!tenant) throw new UnauthorizedException('Tenant not found or inactive');

      // 2. Activate RLS for this tenant so users/user_roles queries work
      await client.query(`SET LOCAL "app.tenant_id" = $1`, [tenant.id]);

      // 3. Find user + their roles in a single query
      const userRes = await client.query<{
        id: string; email: string; name: string;
        password_hash: string; is_active: boolean;
        roles: string[];
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

      if (!user || !user.is_active) throw new UnauthorizedException('Invalid credentials');

      const valid = await this.passwordService.verify(dto.password, user.password_hash);
      if (!valid) throw new UnauthorizedException('Invalid credentials');

      const token = this.jwtService.sign({
        sub: user.id,
        tenant_id: tenant.id,
        email: user.email,
        roles: user.roles,
      });

      return {
        token,
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
}
```

**Step 3: Verify no TS errors locally (optional but useful)**
```bash
cd backend && npx tsc --noEmit 2>&1 | grep auth
```

---

## Task 2: Backend — Auth Controller + Module

**Files:**
- Create: `backend/src/api/v1/auth/auth.controller.ts`
- Create: `backend/src/api/v1/auth/auth.module.ts`
- Modify: `backend/src/api/v1/api-v1.module.ts`

**Step 1: Create AuthController**

```typescript
// backend/src/api/v1/auth/auth.controller.ts
import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from '../../../gateway/decorators/public.decorator';

@Controller('auth')
@Public()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }
}
```

**Step 2: Create AuthModule**

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
      secret: config.JWT_SECRET_FALLBACK,
      signOptions: { expiresIn: '24h', algorithm: 'HS256' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
```

**Step 3: Register in ApiV1Module**

```typescript
// backend/src/api/v1/api-v1.module.ts
import { Module } from '@nestjs/common';
import { ApiV1Controller } from './api-v1.controller';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ApiV1Controller],
})
export class ApiV1Module {}
```

**Step 4: Smoke test (requires running backend)**
```bash
curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"tenantSlug":"acme","email":"admin@acme.example.com","password":"password123"}' | python3 -m json.tool
# Expected: { token: "eyJ...", user: {...}, tenant: {...} }
```

**Step 5: Commit**
```bash
cd backend
git add src/api/v1/auth/ src/api/v1/api-v1.module.ts
git commit -m "feat(api): add POST /auth/login endpoint"
```

---

## Task 3: Frontend — Fix Types

**Files:**
- Modify: `frontend/web/src/types/api.types.ts`

Replace the entire file:

```typescript
// frontend/web/src/types/api.types.ts

/** Matches backend Customer entity (customers table) */
export interface Customer {
  id: string;
  tenant_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Matches backend SupportCase entity (support_cases table) */
export interface SupportCase {
  id: string;
  tenant_id: string;
  customer_id: string;
  customer_name: string | null;
  title: string;
  description: string | null;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high';
  assigned_to: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Backend list response: { plugin, data, count } */
export interface PluginListResponse<T> {
  plugin: string;
  data: T[];
  count: number;
}

/** Backend single-item response: { plugin, data } */
export interface PluginItemResponse<T> {
  plugin: string;
  data: T;
}

export interface LoginResponse {
  token: string;
  user: { id: string; name: string; email: string; roles: string[] };
  tenant: { id: string; subdomain: string; name: string; tier: string };
}

export interface ApiErrorBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
}
```

---

## Task 4: Frontend — Fix API Client

**Files:**
- Modify: `frontend/web/src/lib/api-client.ts`

Replace the entire file:

```typescript
// frontend/web/src/lib/api-client.ts
import type {
  Customer,
  SupportCase,
  PluginListResponse,
  LoginResponse,
  ApiErrorBody,
} from '@/types/api.types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody,
  ) {
    super(body.detail ?? body.title);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { token?: string; tenantId?: string } = {},
): Promise<T> {
  const { token, tenantId, ...fetchInit } = init;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(tenantId ? { 'X-Tenant-ID': tenantId } : {}),
    ...(fetchInit.headers as Record<string, string> | undefined),
  };

  const res = await fetch(`${BASE_URL}${path}`, { ...fetchInit, headers });

  if (!res.ok) {
    const body: ApiErrorBody = await res.json().catch(() => ({
      type: 'about:blank',
      title: res.statusText,
      status: res.status,
      detail: res.statusText,
      instance: path,
    }));
    throw new ApiError(res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

interface AuthCtx {
  token: string;
  tenantId: string;
}

export const crmApi = {
  // ─── Auth ─────────────────────────────────────────────────────────────────
  login(body: { tenantSlug: string; email: string; password: string }): Promise<LoginResponse> {
    return request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  // ─── Plugins ──────────────────────────────────────────────────────────────
  getEnabledPlugins(ctx: AuthCtx): Promise<{ enabledPlugins: string[] }> {
    return request('/api/v1/plugins', ctx);
  },

  // ─── Customers (customer-data plugin) ────────────────────────────────────
  getCustomers(ctx: AuthCtx): Promise<PluginListResponse<Customer>> {
    return request('/api/v1/plugins/customer-data/customers', ctx);
  },

  getCustomer(id: string, ctx: AuthCtx): Promise<{ plugin: string; data: Customer }> {
    return request(`/api/v1/plugins/customer-data/customers/${id}`, ctx);
  },

  createCustomer(
    input: { name: string; email?: string; phone?: string; company?: string },
    ctx: AuthCtx,
  ): Promise<{ plugin: string; data: Customer }> {
    return request('/api/v1/plugins/customer-data/customers', {
      method: 'POST',
      body: JSON.stringify(input),
      ...ctx,
    });
  },

  // ─── Cases (customer-care plugin) ─────────────────────────────────────────
  getCases(ctx: AuthCtx): Promise<PluginListResponse<SupportCase>> {
    return request('/api/v1/plugins/customer-care/cases', ctx);
  },

  createCase(
    input: { customer_id: string; title: string; description?: string; priority?: string },
    ctx: AuthCtx,
  ): Promise<{ plugin: string; data: SupportCase }> {
    return request('/api/v1/plugins/customer-care/cases', {
      method: 'POST',
      body: JSON.stringify(input),
      ...ctx,
    });
  },

  updateCase(
    id: string,
    input: Partial<Pick<SupportCase, 'title' | 'description' | 'status' | 'priority' | 'assigned_to'>>,
    ctx: AuthCtx,
  ): Promise<{ plugin: string; data: SupportCase }> {
    return request(`/api/v1/plugins/customer-care/cases/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
      ...ctx,
    });
  },
};
```

> **Note:** Default BASE_URL changed from `localhost:8080` → `localhost:3000` to match actual backend port.

---

## Task 5: Frontend — Fix Auth Store

**Files:**
- Modify: `frontend/web/src/stores/auth.store.ts`

Add `userName` to persisted state so we can display it in the UI:

```typescript
// frontend/web/src/stores/auth.store.ts
'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  token: string | null;
  tenantId: string | null;
  tenantName: string | null;
  userName: string | null;
  userEmail: string | null;
  setAuth: (payload: {
    token: string;
    tenantId: string;
    tenantName: string;
    userName: string;
    userEmail: string;
  }) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      tenantId: null,
      tenantName: null,
      userName: null,
      userEmail: null,
      setAuth: ({ token, tenantId, tenantName, userName, userEmail }) =>
        set({ token, tenantId, tenantName, userName, userEmail }),
      logout: () =>
        set({ token: null, tenantId: null, tenantName: null, userName: null, userEmail: null }),
    }),
    {
      name: 'crm-web-auth',
      partialize: (s) => ({
        token: s.token,
        tenantId: s.tenantId,
        tenantName: s.tenantName,
        userName: s.userName,
        userEmail: s.userEmail,
      }),
    },
  ),
);
```

---

## Task 6: Frontend — Add Login Page

**Files:**
- Create: `frontend/web/src/app/login/page.tsx`

```tsx
// frontend/web/src/app/login/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi, ApiError } from '@/lib/api-client';

export default function LoginPage() {
  const router = useRouter();
  const { setAuth } = useAuthStore();

  const [tenantSlug, setTenantSlug] = useState('acme');
  const [email, setEmail] = useState('admin@acme.example.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await crmApi.login({ tenantSlug, email, password });
      setAuth({
        token: res.token,
        tenantId: res.tenant.id,
        tenantName: res.tenant.name,
        userName: res.user.name,
        userEmail: res.user.email,
      });
      router.push('/contacts');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8">
        <h1 className="mb-6 text-xl font-semibold">Sign in to CRM</h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Tenant</label>
            <input
              value={tenantSlug}
              onChange={(e) => setTenantSlug(e.target.value)}
              placeholder="acme"
              required
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="mt-1 text-xs text-muted-foreground">acme · globex · initech</p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@acme.example.com"
              required
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="password123"
              required
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Dev password: <span className="font-mono">password123</span>
        </p>
      </div>
    </div>
  );
}
```

---

## Task 7: Frontend — Fix Root Page + CRM Layout (auth guard)

**Files:**
- Modify: `frontend/web/src/app/page.tsx`
- Modify: `frontend/web/src/app/(crm)/layout.tsx`

**Step 1: Root page — auth-aware redirect**

```tsx
// frontend/web/src/app/page.tsx
import { redirect } from 'next/navigation';

// Always redirect to /contacts; the CRM layout will redirect to /login if unauthenticated.
export default function RootPage() {
  redirect('/contacts');
}
```

**Step 2: CRM layout — auth guard + updated nav**

```tsx
// frontend/web/src/app/(crm)/layout.tsx
'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Users, Headset, LogOut } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';

const PLUGIN_PAGES = [
  { plugin: 'customer-data', label: 'Contacts', href: '/contacts', icon: Users },
  { plugin: 'customer-care', label: 'Cases', href: '/cases', icon: Headset },
];

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { token, tenantId, tenantName, userName, logout } = useAuthStore();

  // Auth guard — runs client-side after hydration
  useEffect(() => {
    if (!token || !tenantId) {
      router.replace('/login');
    }
  }, [token, tenantId, router]);

  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const { data, isLoading } = useQuery({
    queryKey: ['enabled-plugins', tenantId],
    queryFn: () => crmApi.getEnabledPlugins(ctx),
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(token && tenantId),
  });

  const enabledPlugins = data?.enabledPlugins ?? [];
  const visibleNav = isLoading
    ? []
    : PLUGIN_PAGES.filter((p) => enabledPlugins.includes(p.plugin));

  if (!token || !tenantId) {
    // Render nothing while the redirect is in-flight
    return null;
  }

  function handleLogout() {
    logout();
    router.replace('/login');
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex h-screen w-52 flex-shrink-0 flex-col border-r border-border bg-card">
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <span className="text-sm font-semibold">{tenantName ?? 'CRM'}</span>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {isLoading ? (
            <div className="space-y-1">
              {[1, 2].map((i) => (
                <div key={i} className="h-9 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : (
            visibleNav.map(({ label, href, icon: Icon }) => {
              const isActive = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              );
            })
          )}
        </nav>

        <div className="border-t border-border p-3">
          <div className="mb-2 px-3 text-xs text-muted-foreground">{userName}</div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
```

---

## Task 8: Frontend — Fix Contacts Page + ContactsList Component

**Files:**
- Modify: `frontend/web/src/app/(crm)/contacts/page.tsx`
- Modify: `frontend/web/src/components/contacts-list.tsx`

**Step 1: Fix ContactsPage**

```tsx
// frontend/web/src/app/(crm)/contacts/page.tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import { ContactsList } from '@/components/contacts-list';
import { PluginGate } from '@/components/plugin-gate';

export default function ContactsPage() {
  const { token, tenantId } = useAuthStore();
  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['customers'],
    queryFn: () => crmApi.getCustomers(ctx),
    enabled: Boolean(token && tenantId),
  });

  return (
    <PluginGate plugin="customer-data" pluginLabel="Customer Data">
      <div>
        <div className="mb-6">
          <h1 className="text-xl font-semibold">Contacts</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {data ? `${data.count} contacts` : 'Manage your contacts'}
          </p>
        </div>

        {isLoading ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            Loading…
          </div>
        ) : isError ? (
          <div className="flex h-64 items-center justify-center text-red-600">
            Failed to load contacts.
          </div>
        ) : (
          <ContactsList contacts={data?.data ?? []} />
        )}
      </div>
    </PluginGate>
  );
}
```

**Step 2: Fix ContactsList — use Customer type (single `name` field, `is_active` badge)**

```tsx
// frontend/web/src/components/contacts-list.tsx
'use client';

// Also exposed as Module Federation remote module (see next.config.ts).
// Admin Console can lazy-load: const ContactsList = React.lazy(() => import('web/ContactsList'));

import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useState } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import type { Customer } from '@/types/api.types';

const columns: ColumnDef<Customer>[] = [
  {
    accessorKey: 'name',
    header: ({ column }) => (
      <button onClick={() => column.toggleSorting()} className="flex items-center gap-1 font-medium">
        Name
        {column.getIsSorted() === 'asc' ? (
          <ArrowUp className="h-3 w-3" />
        ) : column.getIsSorted() === 'desc' ? (
          <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    ),
    cell: ({ row }) => (
      <div>
        <p className="font-medium">{row.original.name}</p>
        {row.original.email && (
          <p className="text-xs text-muted-foreground">{row.original.email}</p>
        )}
      </div>
    ),
  },
  {
    accessorKey: 'company',
    header: 'Company',
    cell: ({ getValue }) => getValue<string | null>() ?? '—',
  },
  {
    accessorKey: 'phone',
    header: 'Phone',
    cell: ({ getValue }) => getValue<string | null>() ?? '—',
  },
  {
    accessorKey: 'is_active',
    header: 'Status',
    cell: ({ getValue }) => {
      const active = getValue<boolean>();
      return (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'
          }`}
        >
          {active ? 'Active' : 'Inactive'}
        </span>
      );
    },
  },
];

export function ContactsList({ contacts }: { contacts: Customer[] }) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data: contacts,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border bg-muted/30">
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-border transition-colors last:border-0 hover:bg-muted/50"
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {contacts.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-muted-foreground">
                  No contacts found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

---

## Task 9: Frontend — Replace Deals with Cases

**Files:**
- Create: `frontend/web/src/app/(crm)/cases/page.tsx`
- Create: `frontend/web/src/components/cases-list.tsx`
- Delete: `frontend/web/src/app/(crm)/deals/page.tsx`
- Delete: `frontend/web/src/app/(crm)/deals/` directory
- Delete: `frontend/web/src/components/deals-list.tsx`

**Step 1: Create CasesPage**

```tsx
// frontend/web/src/app/(crm)/cases/page.tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import { CasesList } from '@/components/cases-list';
import { PluginGate } from '@/components/plugin-gate';
import type { SupportCase } from '@/types/api.types';

const STATUSES: { value: SupportCase['status'] | ''; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

export default function CasesPage() {
  const { token, tenantId } = useAuthStore();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const { data, isLoading } = useQuery({
    queryKey: ['cases'],
    queryFn: () => crmApi.getCases(ctx),
    enabled: Boolean(token && tenantId),
  });

  const filtered = statusFilter
    ? (data?.data ?? []).filter((c) => c.status === statusFilter)
    : (data?.data ?? []);

  return (
    <PluginGate plugin="customer-care" pluginLabel="Customer Care">
      <div>
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold">Cases</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {data ? `${data.count} support cases` : 'Manage support cases'}
            </p>
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            Loading…
          </div>
        ) : (
          <CasesList cases={filtered} />
        )}
      </div>
    </PluginGate>
  );
}
```

**Step 2: Create CasesList component**

```tsx
// frontend/web/src/components/cases-list.tsx
'use client';

import type { SupportCase } from '@/types/api.types';

const STATUS_STYLE: Record<SupportCase['status'], string> = {
  open: 'bg-sky-100 text-sky-700',
  in_progress: 'bg-amber-100 text-amber-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-slate-100 text-slate-600',
};

const PRIORITY_STYLE: Record<SupportCase['priority'], string> = {
  low: 'text-slate-500',
  medium: 'text-amber-600',
  high: 'text-red-600',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function CasesList({ cases }: { cases: SupportCase[] }) {
  if (cases.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">No cases found.</p>
    );
  }

  return (
    <div className="space-y-2">
      {cases.map((c) => (
        <div key={c.id} className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm">{c.title}</p>
              {c.customer_name && (
                <p className="mt-0.5 text-xs text-muted-foreground">Customer: {c.customer_name}</p>
              )}
              {c.description && (
                <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{c.description}</p>
              )}
            </div>
            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[c.status]}`}>
                {c.status.replace('_', ' ')}
              </span>
              <span className={`text-xs font-medium ${PRIORITY_STYLE[c.priority]}`}>
                {c.priority}
              </span>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{formatDate(c.created_at)}</p>
        </div>
      ))}
    </div>
  );
}
```

**Step 3: Delete old files**

```bash
cd frontend/web
rm -rf src/app/\(crm\)/deals/
rm src/app/\(crm\)/tasks/page.tsx
rm src/components/deals-list.tsx
```

**Step 4: Also delete contact.store.ts** (no longer needed — contacts page uses TanStack Query, not Zustand)
```bash
rm src/stores/contact.store.ts
```

---

## Task 10: Frontend — Cleanup contact.store references + PluginGate

**Files:**
- Modify: `frontend/web/src/components/plugin-gate.tsx`
- Verify `contacts/page.tsx` no longer imports `contact.store`

The `plugin-gate.tsx` already uses correct `getEnabledPlugins` call — no change needed there.

Check that `contacts/page.tsx` (updated in Task 8) does NOT import `contact.store`. If it does, remove that import and the `useContactStore` usage.

---

## Task 11: Final verification

**Step 1: TypeScript check**
```bash
cd frontend/web && npx tsc --noEmit
cd backend && npx tsc --noEmit
```

**Step 2: Start backend + frontend, test full flow**
```bash
# Terminal 1 (backend)
cd backend && npm run start:dev

# Terminal 2 (frontend/web)
cd frontend/web && npm run dev
```

**Step 3: Manual flow**
1. Open `http://localhost:3002`
2. Should redirect to `/login`
3. Enter: tenant=`acme`, email=`admin@acme.example.com`, password=`password123`
4. Should land on Contacts page showing customers from DB
5. Click Cases → shows support_cases (acme has customer-care enabled)
6. Try globex (analytics plugin, no customer-care) → Cases nav item should be absent
7. Sign out → returns to login

**Step 4: Commit**
```bash
cd frontend/web
git add src/
git commit -m "fix(web): align frontend with real backend — auth, endpoints, data models"
```

---

## Summary of changes

| Layer | Change |
|---|---|
| Backend | New `POST /auth/login` using PoolRegistry metadata pool + JwtService |
| Frontend types | `Customer` + `SupportCase` match DB schema; removed `Deal`, `Task`, `PaginatedResponse` |
| Frontend api-client | Fixed endpoints, response parsing, BASE_URL default (`8080` → `3000`) |
| Frontend auth | Login page + auth guard in CRM layout + enriched auth store |
| Frontend nav | Contacts + Cases only; no Tasks |
| Frontend pages | Contacts uses `Customer.name`; Deals replaced by Cases |
| Frontend components | `ContactsList` uses `Customer`; new `CasesList`; `DealsList` deleted |
