// ============================================================
// @CurrentTenant() — param decorator để lấy ResolvedTenant từ request
// @CurrentUser()   — param decorator để lấy JwtClaims từ request
//
// Usage trong controller:
//   @Get('profile')
//   getProfile(
//     @CurrentTenant() tenant: ResolvedTenant,
//     @CurrentUser() user: JwtClaims,
//   ) { ... }
// ============================================================
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { ResolvedTenant } from '../dto/resolved-tenant.dto';
import type { JwtClaims } from '../dto/jwt-claims.dto';

/** Lấy tenant đã được resolve trong TenantResolverMiddleware */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ResolvedTenant => {
    const req = ctx.switchToHttp().getRequest<Request & { resolvedTenant?: ResolvedTenant }>();
    return req.resolvedTenant!;
  }
);

/** Lấy JWT payload sau khi JwtAuthGuard xác thực */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtClaims => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: JwtClaims }>();
    return req.user!;
  }
);
