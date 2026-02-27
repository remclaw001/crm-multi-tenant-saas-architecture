// ============================================================
// GatewayModule — L2 API Gateway
//
// Provides và exports:
//   - CorrelationIdMiddleware  (apply toàn bộ routes)
//   - TenantResolverMiddleware (apply toàn bộ routes trừ health/metrics)
//   - TenantCorsMiddleware     (apply toàn bộ routes — Phase 7)
//   - JwtAuthGuard             (APP_GUARD — global authentication)
//   - JwtStrategy              (Passport strategy)
//   - ThrottlerGuard           (APP_GUARD — global rate limiting)
//
// Middleware order (quan trọng):
//   1. CorrelationIdMiddleware  → gán request ID
//   2. TenantResolverMiddleware → lookup tenant, set AsyncLocalStorage
//   3. TenantCorsMiddleware     → CORS headers dựa trên tenant config
//   4. JwtAuthGuard (Guard)     → verify JWT, cross-validate tenant
// ============================================================
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerGuard } from '@nestjs/throttler';
import { CorrelationIdMiddleware } from './middleware/correlation-id.middleware';
import { TenantResolverMiddleware } from './middleware/tenant-resolver.middleware';
import { TenantCorsMiddleware } from './middleware/tenant-cors.middleware';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    // Passport cần được khởi tạo — default strategy 'jwt' match với JwtStrategy
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  providers: [
    // ── Passport strategy ─────────────────────────────────
    JwtStrategy,

    // ── Global Guards (APP_GUARD) ──────────────────────────
    // NestJS áp dụng APP_GUARD cho TẤT CẢ routes tự động.
    // Thứ tự providers quyết định thứ tự guard execution.
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,  // Rate limiting chạy trước auth
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,    // JWT auth — bỏ qua routes @Public()
    },
  ],
})
export class GatewayModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // ── Registration 1: Tenant resolution (excludes infra routes) ──
    // CorrelationId + TenantResolver không cần thiết cho /health, /ready, /metrics
    consumer
      .apply(
        CorrelationIdMiddleware,   // 1st: gán correlationId
        TenantResolverMiddleware,  // 2nd: resolve tenant + set AsyncLocalStorage
      )
      .exclude(
        { path: 'health', method: RequestMethod.GET },
        { path: 'ready', method: RequestMethod.GET },
        { path: 'metrics', method: RequestMethod.GET },
      )
      .forRoutes('*');

    // ── Registration 2: CORS cho TẤT CẢ routes ─────────────
    // Chạy sau TenantResolver → req.resolvedTenant.allowedOrigins đã có.
    // Với /health, /ready, /metrics: req.resolvedTenant = undefined
    //   → TenantCorsMiddleware dùng CORS_ORIGINS env var làm fallback.
    consumer
      .apply(TenantCorsMiddleware)
      .forRoutes('*');
  }
}
