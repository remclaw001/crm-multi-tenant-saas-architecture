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

      // 4. Commit DB work before CPU-intensive password check
      await client.query('COMMIT');

      // 5. Constant-time check: always run bcrypt to prevent timing oracle
      const DUMMY_HASH = '$2b$12$invalidhashusedtoblindtimingXXXXXXXXXXXXXXXXXXXXXXX';
      const hashToCompare = user?.password_hash ?? DUMMY_HASH;
      const valid = await this.passwordService.verify(dto.password, hashToCompare);

      if (!user || !user.is_active || !valid) {
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
