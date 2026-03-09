# Design: Admin Tenant User Management

## Overview

Add a User Management section to the tenant detail page in the admin console.
Supports: list, add, edit (name/email/role/password reset), disable/enable, delete.

## Backend

### Endpoints

All under `AdminTenantsController` (`@UseGuards(SuperAdminGuard)`), added to existing file.

| Method | Path | Body / Notes |
|--------|------|--------------|
| GET | `/api/v1/admin/tenants/:id/users` | Returns users with their role |
| POST | `/api/v1/admin/tenants/:id/users` | `{ name, email, password, role }` |
| PATCH | `/api/v1/admin/tenants/:id/users/:userId` | `{ name?, email?, role?, password? }` |
| PATCH | `/api/v1/admin/tenants/:id/users/:userId/disable` | `{ is_active: boolean }` |
| DELETE | `/api/v1/admin/tenants/:id/users/:userId` | Hard delete |

### Service: `AdminUsersService`

New service injected with `PoolRegistry` and `PasswordService`.

**RLS workaround**: `users`, `roles`, `user_roles` all have FORCE RLS. The metadata
pool connection is a raw pg client — wrap every query in a transaction with
`SET LOCAL app.tenant_id = $1` to satisfy RLS policies.

**Role seeding**: On every user-list or user-create call, ensure `admin` and `manager`
roles exist for the tenant via `INSERT INTO roles ... ON CONFLICT (tenant_id, name) DO NOTHING`.

**Response shape** (per user):
```json
{
  "id": "uuid",
  "name": "string",
  "email": "string",
  "role": "admin | manager | null",
  "is_active": true,
  "created_at": "ISO string"
}
```

Role is the name of the first role assigned to the user via `user_roles`.

### Module wiring

Add `AdminUsersService` to `AdminModule` providers.
Add `AdminUsersController` to `AdminModule` controllers.

## Frontend (admin)

### API client additions (`src/lib/api-client.ts`)

```typescript
getUsers(tenantId, token)        → GET /admin/tenants/:id/users
createUser(tenantId, input, token)
updateUser(tenantId, userId, input, token)
disableUser(tenantId, userId, isActive, token)
deleteUser(tenantId, userId, token)
```

### Types (`src/types/api.types.ts`)

```typescript
interface TenantUser {
  id: string; name: string; email: string;
  role: 'admin' | 'manager' | null;
  is_active: boolean; created_at: string;
}
interface CreateUserInput { name: string; email: string; password: string; role: 'admin' | 'manager'; }
interface UpdateUserInput { name?: string; email?: string; role?: 'admin' | 'manager'; password?: string; }
```

### Components

**`TenantUsersSection`** — inline section on `TenantDetailPage` below Manage Plugins link:
- `useQuery(['tenant-users', tenantId])` to fetch list
- Table columns: Name/Email, Role badge, Status badge, Actions (edit, disable toggle, delete)
- "Add User" button

**`AddUserModal`** — fields: Name*, Email*, Role (select: admin/manager)*, Password*

**`EditUserModal`** — fields: Name*, Email*, Role*; checkbox "Reset password" reveals password field

**`DeleteUserConfirmModal`** — simple confirm dialog showing user name

### Data flow

```
TenantDetailPage
  └── TenantUsersSection (props: tenantId)
        ├── useQuery → GET users
        ├── AddUserModal    → POST → invalidate ['tenant-users', tenantId]
        ├── EditUserModal   → PATCH → invalidate
        ├── disable button  → PATCH /disable → invalidate
        └── DeleteUserConfirmModal → DELETE → invalidate
```

## Constraints

- No new DB migration needed (tables already exist)
- `PasswordService` already global via `SecurityModule` — inject directly
- Email unique per tenant enforced at DB level (unique constraint on `tenant_id, email`)
- Roles `admin` / `manager` are seeded on demand, not at tenant creation time
