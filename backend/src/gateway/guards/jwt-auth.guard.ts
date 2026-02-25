// ============================================================
// JwtAuthGuard — L2 Authentication + Tenant Cross-Validation
//
// Extends Passport AuthGuard('jwt') để:
//   1. Bỏ qua routes được đánh dấu @Public()
//   2. Verify JWT signature qua JwtStrategy
//   3. Cross-validate: JWT tenant_id phải match req.resolvedTenant.id
//      → ngăn token của tenant A dùng cho tenant B
//
// Error hierarchy:
//   401 Unauthorized — không có / invalid / expired JWT
//   403 Forbidden    — JWT hợp lệ nhưng sai tenant
//
// Thay thế cho Fastify preHandler hook JWT verification trong thiết kế gốc.
// ============================================================
import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { JwtClaims } from '../dto/jwt-claims.dto';
import type { ResolvedTenant } from '../dto/resolved-tenant.dto';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(
    context: ExecutionContext
  ): boolean | Promise<boolean> | Observable<boolean> {
    // ── Check @Public() metadata ──────────────────────────
    // getAllAndOverride: kiểm tra handler trước, sau đó class-level
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    // Delegate đến Passport JWT strategy
    return super.canActivate(context);
  }

  handleRequest<T = JwtClaims>(
    err: Error | null,
    user: T | false,
    info: { message?: string } | undefined,
    context: ExecutionContext
  ): T {
    // ── 401: Không có hoặc invalid JWT ────────────────────
    if (err || !user) {
      const message =
        err?.message ??
        info?.message ??
        'Missing or invalid authentication token';
      throw new UnauthorizedException(message);
    }

    // ── Cross-validate tenant ─────────────────────────────
    // JWT tenant_id phải khớp với tenant đã resolve từ header/subdomain.
    // Ngăn scenario: dùng token hợp lệ của acme.app.com để call từ beta.app.com
    const req = context
      .switchToHttp()
      .getRequest<Request & { resolvedTenant?: ResolvedTenant }>();

    const resolvedTenant = req.resolvedTenant;
    const claims = user as unknown as JwtClaims;

    if (resolvedTenant && claims.tenant_id !== resolvedTenant.id) {
      throw new ForbiddenException(
        `JWT tenant mismatch: token belongs to tenant ${claims.tenant_id}, ` +
        `but request targets tenant ${resolvedTenant.id}`
      );
    }

    return user;
  }
}
