// ============================================================
// JwtClaims — payload shape sau khi JwtStrategy.validate() xác thực
//
// Keycloak mặc định đặt custom claims trong token payload.
// JwtStrategy.validate() trả về object này — NestJS gán vào req.user.
// ============================================================

export interface JwtClaims {
  /** User UUID (JWT standard claim "sub") */
  readonly sub: string;

  /** Tenant UUID — phải match với ResolvedTenant.id */
  readonly tenant_id: string;

  /** Danh sách role của user trong tenant này */
  readonly roles: string[];

  /** Email user (optional — Keycloak có thể omit) */
  readonly email?: string;

  /** Issued at (epoch seconds) */
  readonly iat: number;

  /** Expires at (epoch seconds) */
  readonly exp: number;

  /** JWT ID — used to blacklist access tokens on logout */
  readonly jti?: string;
}
