import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PoolRegistry } from '../../../../dal/pool/PoolRegistry';
import { PasswordService } from '../../../../common/security/password.service';
import { config } from '../../../../config/env';

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
    if (!config.JWT_SECRET_FALLBACK) {
      throw new UnauthorizedException('Admin login requires JWT_SECRET_FALLBACK to be set');
    }
    const pool = this.poolRegistry.getMetadataPool();
    const client = await pool.connect();

    try {
      const tenantRes = await client.query<{ id: string; subdomain: string }>(
        `SELECT id, subdomain FROM tenants WHERE subdomain = 'system' AND is_active = true LIMIT 1`,
      );
      const tenant = tenantRes.rows[0];
      if (!tenant) throw new UnauthorizedException('System not configured');

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
