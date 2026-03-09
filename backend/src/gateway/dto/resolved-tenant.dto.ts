// ============================================================
// ResolvedTenant — kết quả lookup từ DB trong TenantResolverMiddleware
//
// Gắn vào req.resolvedTenant để JwtAuthGuard cross-validate
// tenant claim trong JWT với tenant thực tế của request.
// ============================================================
import type { TenantTier, TenantStatus } from '../../dal/context/TenantContext';

export interface ResolvedTenant {
  readonly id: string;                // UUID — primary key trong bảng tenants
  readonly subdomain: string;         // 'acme' từ acme.app.com
  readonly name: string;              // Tên hiển thị
  readonly tier: TenantTier;          // 'basic' | 'premium' | 'enterprise' | 'vip'
  readonly status: TenantStatus;
  readonly dbUrl: string | null;      // Dedicated DB URL (chỉ VIP/Enterprise)
  readonly isActive: boolean;
  /** CORS allowed origins từ tenants.config.allowedOrigins */
  readonly allowedOrigins: string[];
}
