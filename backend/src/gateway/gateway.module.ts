// ============================================================
// GatewayModule — L2 API Gateway
//
// Provides và exports:
//   - TenantResolverMiddleware (apply toàn bộ routes)
//   - CorrelationIdMiddleware  (apply toàn bộ routes)
//   - JwtAuthGuard             (APP_GUARD — global authentication)
//   - JwtStrategy              (Passport strategy)
//   - ThrottlerGuard           (APP_GUARD — global rate limiting)
//
// Middleware order (quan trọng):
//   1. CorrelationIdMiddleware  → gán request ID
//   2. TenantResolverMiddleware → lookup tenant, set AsyncLocalStorage
//   3. JwtAuthGuard (Guard)     → verify JWT, cross-validate tenant
// ============================================================
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerGuard } from '@nestjs/throttler';
import { CorrelationIdMiddleware } from './middleware/correlation-id.middleware';
import { TenantResolverMiddleware } from './middleware/tenant-resolver.middleware';
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
    consumer
      .apply(
        CorrelationIdMiddleware,   // 1st: gán correlationId
        TenantResolverMiddleware   // 2nd: resolve tenant + set AsyncLocalStorage
      )
      // Áp dụng cho tất cả routes NGOẠI TRỪ health (health không cần tenant)
      .exclude(
        { path: 'health', method: RequestMethod.GET },
        { path: 'ready', method: RequestMethod.GET }
      )
      .forRoutes('*');
  }
}
