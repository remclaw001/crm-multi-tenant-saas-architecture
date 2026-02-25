// ============================================================
// ApiV1Controller — /api/v1/:plugin/* routing structure
//
// Đây là placeholder cho Phase 5 (Plugin Registry + ExecutionContext).
// Mục đích Phase 3: chứng minh middleware chain hoạt động đúng:
//   1. TenantResolverMiddleware đã resolve tenant
//   2. JwtAuthGuard đã verify JWT + cross-validate tenant
//   3. TenantContext đã được set (L4 queries sẽ tự scope)
//
// Routes thực sự cho từng plugin sẽ được thêm từ Phase 5 trở đi.
// ============================================================
import { Controller, Get, Param } from '@nestjs/common';
import { TenantContext } from '../../dal/context/TenantContext';
import { CurrentTenant } from '../../gateway/decorators/current-tenant.decorator';
import { CurrentUser } from '../../gateway/decorators/current-tenant.decorator';
import type { ResolvedTenant } from '../../gateway/dto/resolved-tenant.dto';
import type { JwtClaims } from '../../gateway/dto/jwt-claims.dto';

@Controller('api/v1')
export class ApiV1Controller {
  /**
   * GET /api/v1/:plugin/ping
   *
   * Smoke test endpoint — chứng minh toàn bộ middleware chain hoạt động:
   * - tenant đã resolved (từ X-Tenant-ID header hoặc subdomain)
   * - JWT đã verified và tenant cross-validated
   * - TenantContext đã set (queryCount có thể increment)
   *
   * Response cung cấp đủ thông tin để integration test verify.
   */
  @Get(':plugin/ping')
  ping(
    @Param('plugin') plugin: string,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
  ) {
    return {
      plugin,
      tenant: {
        id: tenant.id,
        subdomain: tenant.subdomain,
        tier: tenant.tier,
      },
      user: {
        sub: user.sub,
        tenant_id: user.tenant_id,
        roles: user.roles,
      },
      // Verify TenantContext.run() đã được set bởi middleware
      context: {
        tenantId: TenantContext.getTenantId(),
        queryCount: TenantContext.getQueryCount(),
      },
      timestamp: new Date().toISOString(),
    };
  }
}
