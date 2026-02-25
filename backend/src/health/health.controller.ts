// ============================================================
// HealthController — GET /health và GET /ready
//
// /health  → Liveness probe: server đang chạy (luôn 200 nếu process sống)
// /ready   → Readiness probe: DB + Redis sẵn sàng nhận traffic
//
// Cả hai routes đều @Public() — không cần JWT / tenant context.
// Kubernetes probe không có JWT → nếu không @Public() sẽ 401.
//
// TenantResolverMiddleware cũng đã exclude '/health' và '/ready'
// nên không cần X-Tenant-ID header.
// ============================================================
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { Public } from '../gateway/decorators/public.decorator';
import { DbHealthIndicator } from './indicators/db-health.indicator';
import { RedisHealthIndicator } from './indicators/redis-health.indicator';

@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: DbHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  /**
   * GET /health — Liveness probe
   * Kubernetes chỉ cần biết process còn sống.
   * Trả về 200 ngay lập tức — không check external deps.
   */
  @Get('health')
  @Public()
  liveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * GET /ready — Readiness probe
   * Check DB + Redis trước khi nhận traffic.
   * Trả về 503 nếu bất kỳ dependency nào fail.
   */
  @Get('ready')
  @Public()
  @HealthCheck()
  readiness() {
    return this.health.check([
      () => this.db.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
    ]);
  }
}
