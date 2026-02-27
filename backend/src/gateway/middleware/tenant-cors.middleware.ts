// ============================================================
// TenantCorsMiddleware — Per-tenant CORS enforcement
//
// Chạy SAU TenantResolverMiddleware để có req.resolvedTenant.
// Enforce CORS dựa trên allowed origins của từng tenant thay
// vì global wildcard.
//
// Priority:
//   1. req.resolvedTenant.allowedOrigins (tenant-specific từ DB)
//   2. CORS_ORIGINS env var (global fallback, comma-separated)
//   3. Nếu cả hai đều empty → allow tất cả (dev/internal only)
//
// Preflight (OPTIONS) được handle: trả về 204 No Content ngay.
//
// Thay thế app.enableCors() trong main.ts — KHÔNG gọi cả hai.
// ============================================================
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import type { ResolvedTenant } from '../dto/resolved-tenant.dto';
import { config } from '../../config/env';

const ALLOWED_METHODS = 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS';
const ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-Tenant-ID',
  'X-Tenant-Slug',
  'X-Correlation-ID',
].join(',');
const PREFLIGHT_CACHE_SECONDS = '86400'; // 24h

function applyHeaders(res: Response, origin: string, isPreflight: boolean): void {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');

  if (isPreflight) {
    res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
    res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
    res.setHeader('Access-Control-Max-Age', PREFLIGHT_CACHE_SECONDS);
  }
}

@Injectable()
export class TenantCorsMiddleware implements NestMiddleware {
  private readonly globalOrigins: string[];

  constructor() {
    this.globalOrigins = config.CORS_ORIGINS
      ? config.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
      : [];
  }

  use(
    req: Request & { resolvedTenant?: ResolvedTenant },
    res: Response,
    next: NextFunction,
  ): void {
    const requestOrigin = req.headers['origin'];

    // No Origin header → same-origin or non-browser request
    if (!requestOrigin) {
      return next();
    }

    const isPreflight = req.method === 'OPTIONS';

    // Gather allowed origins: tenant-specific overrides global
    const tenantOrigins = req.resolvedTenant?.allowedOrigins ?? [];
    const allowedOrigins = tenantOrigins.length > 0 ? tenantOrigins : this.globalOrigins;

    // No origins configured → dev/internal mode: allow everything
    if (allowedOrigins.length === 0) {
      applyHeaders(res, requestOrigin, isPreflight);
      if (isPreflight) {
        res.status(204).end();
        return;
      }
      return next();
    }

    // Check if request Origin is in the allowed list
    if (allowedOrigins.includes(requestOrigin)) {
      applyHeaders(res, requestOrigin, isPreflight);
      if (isPreflight) {
        res.status(204).end();
        return;
      }
    }
    // Origin not in allowed list → no CORS headers → browser blocks the response

    return next();
  }
}
