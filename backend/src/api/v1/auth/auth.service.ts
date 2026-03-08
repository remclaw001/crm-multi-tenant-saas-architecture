import { Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { PoolRegistry } from '../../../dal/pool/PoolRegistry';
import { PasswordService } from '../../../common/security/password.service';
import type { LoginDto } from './dto/login.dto';

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
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);

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

  async refresh(rawToken: string): Promise<{ token: string; refreshToken: string }> {
    const pool = this.poolRegistry.getMetadataPool();
    const client = await pool.connect();

    try {
      const tokenHash = this.hashToken(rawToken);

      // 1. Look up refresh token record (no transaction yet — validation only)
      const rtRes = await client.query<{
        id: string; user_id: string; tenant_id: string; expires_at: Date;
      }>(
        `SELECT id, user_id, tenant_id, expires_at
         FROM refresh_tokens
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [tokenHash],
      );
      const rt = rtRes.rows[0];
      if (!rt) throw new UnauthorizedException('Invalid refresh token');
      if (rt.expires_at < new Date()) throw new UnauthorizedException('Refresh token expired');

      // 2. Load user with roles (still no transaction)
      const userRes = await client.query<{
        id: string; email: string; name: string; is_active: boolean; roles: string[];
      }>(
        `SELECT u.id, u.email, u.name, u.is_active,
                COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = $2
         LEFT JOIN roles r ON r.id = ur.role_id AND r.tenant_id = $2
         WHERE u.id = $1 AND u.tenant_id = $2
         GROUP BY u.id`,
        [rt.user_id, rt.tenant_id],
      );
      const user = userRes.rows[0];
      if (!user || !user.is_active) throw new UnauthorizedException('User inactive');

      // 3. Rotate refresh token atomically — transaction starts here
      let inTransaction = false;
      try {
        await client.query('BEGIN');
        inTransaction = true;
        await client.query(
          `UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`,
          [rt.id],
        );
        const newRefreshToken = await this.issueRefreshToken(client, rt.user_id, rt.tenant_id);
        await client.query('COMMIT');
        inTransaction = false;

        // 4. Issue new access token
        const jti = randomUUID();
        const token = this.jwtService.sign({
          sub: user.id,
          tenant_id: rt.tenant_id,
          email: user.email,
          roles: user.roles,
          jti,
        });

        return { token, refreshToken: newRefreshToken };
      } catch (txErr) {
        if (inTransaction) {
          await client.query('ROLLBACK').catch(() => {});
        }
        throw txErr;
      }
    } finally {
      client.release();
    }
  }

  async logout(jti: string, exp: number): Promise<void> {
    const ttl = exp - Math.floor(Date.now() / 1000);
    if (ttl <= 0) return;
    await this.redis.setex(`auth:blacklist:${jti}`, ttl, '1');
  }

  private async issueRefreshToken(
    client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    userId: string,
    tenantId: string,
  ): Promise<string> {
    const token = randomBytes(48).toString('hex'); // 96 hex chars
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

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
