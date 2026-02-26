// ============================================================
// MetricsController — GET /metrics
//
// Prometheus scraper pull metrics theo interval (default 15s).
// Endpoint này cần được bảo vệ bởi IP allowlist trong production
// (nginx/Kong chỉ cho Prometheus server truy cập).
//
// Trong Phase 3, endpoint là @Public() để dev có thể truy cập trực tiếp.
// Phase 10 (Kong Gateway) sẽ thêm IP restriction.
//
// TenantResolverMiddleware được exclude '/metrics' (như '/health', '/ready')
// → không cần X-Tenant-ID header.
// ============================================================
import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../gateway/decorators/public.decorator';
import { PrometheusService } from './prometheus.service';

@Controller()
export class MetricsController {
  constructor(private readonly prometheus: PrometheusService) {}

  /**
   * GET /metrics — Prometheus scrape endpoint
   *
   * Trả về tất cả metrics ở Prometheus text exposition format.
   * Content-Type: text/plain; version=0.0.4; charset=utf-8
   */
  @Get('metrics')
  @Public()
  async scrape(@Res() res: Response): Promise<void> {
    const [metrics, contentType] = await Promise.all([
      this.prometheus.getMetrics(),
      Promise.resolve(this.prometheus.getContentType()),
    ]);

    res.setHeader('Content-Type', contentType).send(metrics);
  }
}
