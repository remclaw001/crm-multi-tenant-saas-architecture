// ============================================================
// TenantRateLimitMiddleware — Per-Tier Redis-based Rate Limiting
//
// Chạy sau TenantResolverMiddleware (req.resolvedTenant đã có).
//
// Tier limits (requests per minute):
//   basic/standard: 100
//   premium:        500
//   enterprise:     2000
//   vip:            skip (unlimited)
//
// Implementation: sliding-window với Redis INCR + EXPIRE
//   Key: rl:{tenantId}:{minute-bucket}
//   - INCR key → counter trong minute bucket hiện tại
//   - Nếu count === 1 → set EXPIRE 60s (TTL tự động cleanup)
//   - Nếu count > limit → 429 Too Many Requests
// ============================================================
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { CacheManager } from '../../dal/cache/CacheManager';
import type { ResolvedTenant } from '../dto/resolved-tenant.dto';

const TIER_RATE_LIMITS: Record<string, number> = {
  basic:      100,
  standard:   100,
  premium:    500,
  enterprise: 2000,
  vip:        Infinity,
};

@Injectable()
export class TenantRateLimitMiddleware implements NestMiddleware {
  constructor(private readonly cache: CacheManager) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const tenant = (req as Request & { resolvedTenant?: ResolvedTenant }).resolvedTenant;

    // No tenant resolved (public route, health check, etc.) → skip
    if (!tenant) {
      next();
      return;
    }

    const limit = TIER_RATE_LIMITS[tenant.tier] ?? 100;

    // VIP tenants are exempt from rate limiting
    if (limit === Infinity) {
      next();
      return;
    }

    // Sliding-window per-minute bucket
    // Key format: rl:{tenantId}:{minute-bucket}
    const minuteBucket = Math.floor(Date.now() / 60_000);
    const key = `rl:${tenant.id}:${minuteBucket}`;

    const redis = this.cache.client;
    const count = await redis.incr(key);

    // On first request in this bucket, set expiry so Redis auto-cleans old keys
    if (count === 1) {
      await redis.expire(key, 60);
    }

    if (count > limit) {
      res.status(429).json({ statusCode: 429, message: 'Rate limit exceeded' });
      return;
    }

    next();
  }
}
