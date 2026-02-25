// ============================================================
// ResolvedTenant — kết quả lookup từ DB trong TenantResolverMiddleware
//
// Gắn vào req.resolvedTenant để JwtAuthGuard cross-validate
// tenant claim trong JWT với tenant thực tế của request.
// ============================================================
import type { TenantTier } from '../dal/context/TenantContext';

export interface ResolvedTenant {
  readonly id: string;           // UUID — primary key trong bảng tenants
  readonly subdomain: string;    // 'acme' từ acme.app.com
  readonly name: string;         // Tên hiển thị
  readonly tier: TenantTier;     // 'standard' | 'vip' | 'enterprise'
  readonly dbUrl: string | null; // Dedicated DB URL (chỉ VIP/Enterprise)
  readonly isActive: boolean;
}
