// ============================================================
// AppModule — Root NestJS module
//
// Orchestrates toàn bộ application:
//   GatewayModule  → L2: Tenant resolution, JWT auth, rate limiting
//   HealthModule   → Health check endpoints
//   ApiModule      → L3: Business routes /api/v1/...
// ============================================================
import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { config } from './config/env';
import { GatewayModule } from './gateway/gateway.module';
import { HealthModule } from './health/health.module';
import { ApiModule } from './api/api.module';

@Module({
  imports: [
    // ── Rate limiting ────────────────────────────────────────
    // Áp dụng toàn cục qua APP_GUARD trong GatewayModule.
    // ThrottlerModule.forRoot() cung cấp store, GatewayModule expose guard.
    ThrottlerModule.forRoot([
      {
        // 100 requests / 1 phút / IP (Phase 10: Kong thay thế)
        limit: config.THROTTLE_LIMIT,
        ttl: config.THROTTLE_TTL_MS,
      },
    ]),

    // ── L2 Gateway ───────────────────────────────────────────
    // Tenant resolution middleware + JWT guard + global error filter
    GatewayModule,

    // ── Health checks ────────────────────────────────────────
    // GET /health  — liveness probe
    // GET /ready   — readiness probe (DB + Redis + RabbitMQ)
    HealthModule,

    // ── L3 API routes ────────────────────────────────────────
    // Prefix: /api/v1/:plugin/
    ApiModule,
  ],
})
export class AppModule {}
