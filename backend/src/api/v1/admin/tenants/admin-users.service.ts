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

  private async seedRoles(client: { query: Function }, tenantId: string): Promise<void> {
    await client.query(
      `INSERT INTO roles (tenant_id, name, description)
       VALUES ($1, 'admin', 'Administrator'), ($1, 'manager', 'Manager')
       ON CONFLICT (tenant_id, name) DO NOTHING`,
      [tenantId],
    );
  }

  private assertUuid(value: string, label: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`Invalid ${label}`);
    }
  }

  private async withTenant<T>(tenantId: string, fn: (client: { query: Function }) => Promise<T>): Promise<T> {
    this.assertUuid(tenantId, 'tenantId');
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

      let userRow: Omit<TenantUserRow, 'role'>;
      try {
        const res = await client.query(
          `INSERT INTO users (tenant_id, name, email, password_hash)
           VALUES ($1, $2, $3, $4)
           RETURNING id, name, email, is_active, created_at`,
          [tenantId, input.name, input.email, passwordHash],
        );
        userRow = res.rows[0];
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

      return rowToUser({ ...userRow, role: input.role });
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
      const sets: string[] = [];
      const args: unknown[] = [tenantId, userId];
      if (input.name !== undefined)   { args.push(input.name);   sets.push(`name = $${args.length}`); }
      if (input.email !== undefined)  { args.push(input.email);  sets.push(`email = $${args.length}`); }
      if (passwordHash !== undefined) { args.push(passwordHash); sets.push(`password_hash = $${args.length}`); }

      let userRow: Omit<TenantUserRow, 'role'>;

      if (sets.length > 0) {
        const res = await client.query(
          `UPDATE users SET ${sets.join(', ')}, updated_at = NOW()
           WHERE tenant_id = $1 AND id = $2
           RETURNING id, name, email, is_active, created_at`,
          args,
        );
        if (!res.rows[0]) throw new NotFoundException(`User not found: ${userId}`);
        userRow = res.rows[0];
      } else {
        const res = await client.query(
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
        await client.query(
          `DELETE FROM user_roles WHERE user_id = $1 AND tenant_id = $2`,
          [userId, tenantId],
        );
        await client.query(
          `INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3)`,
          [userId, roleRes.rows[0].id, tenantId],
        );
        return rowToUser({ ...userRow, role: input.role });
      }

      const roleRes = await client.query<{ role: string | null }>(
        `SELECT r.name AS role FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = $1 AND ur.tenant_id = $2`,
        [userId, tenantId],
      );
      return rowToUser({ ...userRow, role: roleRes.rows[0]?.role ?? null });
    });
  }

  async setActive(tenantId: string, userId: string, isActive: boolean) {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
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
