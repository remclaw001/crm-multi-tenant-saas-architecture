// ============================================================
// TenantResolverMiddleware — L2 Tenant Resolution
//
// Bước 1 trong request lifecycle: xác định tenant của request.
//
// Nguồn tenant identifier (ưu tiên theo thứ tự):
//   1. Header X-Tenant-ID   → UUID trực tiếp (nội bộ / API clients)
//   2. Header X-Tenant-Slug → Subdomain slug (e.g. 'acme')
//   3. Subdomain từ Host     → 'acme' từ 'acme.app.com'
//
// Sau khi lookup DB (metadata pool):
//   - Gắn tenant vào req.resolvedTenant (để JwtAuthGuard cross-validate)
//   - Gọi TenantContext.run() quanh next() để AsyncLocalStorage
//     tự động truyền tenant_id xuống L4 QueryInterceptor
//
// Error cases:
//   - Không tìm được identifier → 400 Bad Request
//   - Tenant không tồn tại       → 404 Not Found
//   - Tenant bị deactivate       → 403 Forbidden
// ============================================================
import {
  Injectable,
  NestMiddleware,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { config } from '../../config/env';
import { TenantContext } from '../../dal/context/TenantContext';
import type { ResolvedTenant } from '../dto/resolved-tenant.dto';
import type { TenantTier, TenantStatus } from '../../dal/context/TenantContext';
import { CacheManager } from '../../dal/cache/CacheManager';

// ── DB row shape từ tenants table ─────────────────────────────
interface TenantRow {
  id: string;
  name: string;
  subdomain: string;
  tier: TenantTier;
  status: TenantStatus;
  db_url: string | null;
  is_active: boolean;
  config: Record<string, unknown>;
}

// ── Singleton metadata pool ───────────────────────────────────
// Tái sử dụng pool qua các request — không tạo mới mỗi lần lookup.
// Được inject qua PoolRegistry trong production nhưng ở đây dùng trực tiếp
// để middleware không phụ thuộc vào PoolRegistry constructor.
let _metadataPool: Pool | null = null;

function getMetadataPool(): Pool {
  if (!_metadataPool) {
    _metadataPool = new Pool({
      connectionString: config.DATABASE_METADATA_URL ?? config.DATABASE_URL,
      max: config.DATABASE_METADATA_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    _metadataPool.on('error', (err) =>
      console.error('[TenantResolver] Metadata pool error:', err.message)
    );
  }
  return _metadataPool;
}

/**
 * Extract subdomain từ Host header.
 * 'acme.app.com' → 'acme'
 * 'localhost:3000' → null (không có subdomain)
 * 'app.com' → null (chỉ có apex domain)
 */
function extractSubdomain(host: string): string | null {
  const hostname = host.split(':')[0]; // bỏ port
  const parts = hostname.split('.');
  // Cần ít nhất 3 phần: subdomain.domain.tld
  if (parts.length < 3) return null;
  const sub = parts[0];
  // Loại trừ 'www' và các subdomain hệ thống
  if (!sub || sub === 'www' || sub === 'api') return null;
  return sub;
}

@Injectable()
export class TenantResolverMiddleware implements NestMiddleware {
  constructor(private readonly cache: CacheManager) {}

  async use(
    req: Request & { resolvedTenant?: ResolvedTenant },
    res: Response,
    next: NextFunction
  ): Promise<void> {
    // Preflight requests don't carry custom headers — skip tenant resolution,
    // let TenantCorsMiddleware handle CORS headers.
    if (req.method === 'OPTIONS') {
      return next();
    }

    // ── 1. Xác định tenant identifier ──────────────────────
    const tenantIdHeader = req.headers['x-tenant-id'] as string | undefined;
    const tenantSlugHeader = req.headers['x-tenant-slug'] as string | undefined;
    const hostSubdomain = extractSubdomain(req.headers['host'] ?? '');

    const tenantIdentifier = tenantIdHeader ?? tenantSlugHeader ?? hostSubdomain;

    if (!tenantIdentifier) {
      throw new BadRequestException(
        'Cannot determine tenant: provide X-Tenant-ID header, X-Tenant-Slug header, or use a subdomain (e.g. acme.app.com)'
      );
    }

    // ── 2. Lookup tenant trong DB ───────────────────────────
    const tenant = await this.lookupTenant(tenantIdentifier);

    if (!tenant) {
      throw new NotFoundException(`Tenant not found: ${tenantIdentifier}`);
    }

    const { status } = tenant;

    if (!status) {
      throw new InternalServerErrorException('Tenant configuration error: missing status');
    }

    // provisioning/migrating → 503 Service Unavailable
    if (status === 'provisioning' || status === 'migrating') {
      const msg = status === 'provisioning'
        ? 'Tenant is being provisioned, please try again later'
        : 'System migration in progress, please try again later';
      res.status(503).json({ statusCode: 503, message: msg });
      return;
    }

    // offboarding → 401
    if (status === 'offboarding') {
      throw new UnauthorizedException('Account is being closed');
    }

    // offboarded → 404 (like tenant doesn't exist)
    if (status === 'offboarded') {
      throw new NotFoundException(`Tenant not found: ${tenant.subdomain}`);
    }

    // grace_period → add warning header, continue normally
    if (status === 'grace_period') {
      res.setHeader('X-Billing-Warning', 'Payment overdue — account will be suspended soon');
      // Intentional fall-through: grace_period requests continue normally after header is set
    }

    // suspended → allow GET/OPTIONS/HEAD, block writes with 402
    if (status === 'suspended') {
      if (req.method !== 'GET' && req.method !== 'OPTIONS' && req.method !== 'HEAD') {
        throw new HttpException('Account suspended. Please make payment to continue.', HttpStatus.PAYMENT_REQUIRED);
      }
    }

    // backward compat: is_active=false but status still shows active
    if (!tenant.isActive && status === 'active') {
      throw new ForbiddenException(`Tenant is inactive: ${tenant.subdomain}`);
    }

    // ── 3. Gắn vào request (cho JwtAuthGuard cross-validate) ─
    req.resolvedTenant = tenant;

    // ── 4. Set AsyncLocalStorage context ────────────────────
    // TẤT CẢ code sau next() (guards, interceptors, controller handler)
    // đều kế thừa AsyncLocalStorage context này.
    // L4 QueryInterceptor tự động dùng tenantId để set app.tenant_id.
    TenantContext.run(
      { tenantId: tenant.id, tenantTier: tenant.tier },
      () => next()
    );
  }

  private async lookupTenant(identifier: string): Promise<ResolvedTenant | null> {
    // 1. Cache-aside: check Redis first
    const cached = await this.cache.getTenantLookup(identifier);
    if (cached) return cached as ResolvedTenant;

    // 2. Cache miss: query PostgreSQL metadata pool
    const pool = getMetadataPool();

    // Xác định lookup strategy: UUID hoặc subdomain slug
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

    const { rows } = await pool.query<TenantRow>(
      isUuid
        ? 'SELECT id, name, subdomain, tier, status, db_url, is_active, config FROM tenants WHERE id = $1 LIMIT 1'
        : 'SELECT id, name, subdomain, tier, status, db_url, is_active, config FROM tenants WHERE subdomain = $1 LIMIT 1',
      [identifier]
    );

    if (rows.length === 0) return null;

    const row = rows[0];
    // Parse allowed CORS origins from tenant config JSON
    const configJson = row.config ?? {};
    const allowedOrigins = Array.isArray(configJson['allowedOrigins'])
      ? (configJson['allowedOrigins'] as string[])
      : [];

    const resolved: ResolvedTenant = {
      id: row.id,
      name: row.name,
      subdomain: row.subdomain,
      tier: row.tier,
      status: row.status,
      dbUrl: row.db_url,
      isActive: row.is_active,
      allowedOrigins,
    };

    // 3. Write to cache (both by id and by subdomain)
    await this.cache.setTenantLookup(resolved);

    return resolved;
  }
}
