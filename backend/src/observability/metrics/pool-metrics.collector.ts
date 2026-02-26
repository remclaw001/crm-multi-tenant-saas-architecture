// ============================================================
// PoolMetricsCollector — cập nhật DB pool Prometheus gauges
//
// Định kỳ (mặc định 15s) đọc stats từ PoolRegistry và cập nhật:
//   crm_db_pool_connections_total{pool_name}
//   crm_db_pool_connections_idle{pool_name}
//   crm_db_pool_connections_waiting{pool_name}
//
// PoolRegistry được inject từ DalModule (@Global() singleton).
// Metrics phản ánh đúng pool đang phục vụ request thực tế.
//
// Lifecycle:
//   onApplicationBootstrap → bắt đầu interval
//   onApplicationShutdown  → dừng interval (DalModule owns pool lifecycle)
// ============================================================
import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Logger,
} from '@nestjs/common';
import { PoolRegistry } from '../../dal/pool/PoolRegistry';
import { PrometheusService } from './prometheus.service';
import { config } from '../../config/env';

@Injectable()
export class PoolMetricsCollector
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PoolMetricsCollector.name);
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(
    private readonly prometheus: PrometheusService,
    private readonly poolRegistry: PoolRegistry,
  ) {}

  onApplicationBootstrap(): void {
    this.collectOnce(); // Lần đầu tiên ngay lập tức
    this.intervalHandle = setInterval(
      () => this.collectOnce(),
      config.POOL_METRICS_INTERVAL_MS
    );
    this.logger.log(
      `Pool metrics collection started (interval: ${config.POOL_METRICS_INTERVAL_MS}ms)`
    );
  }

  onApplicationShutdown(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.logger.log('Pool metrics collector shut down');
  }

  private collectOnce(): void {
    try {
      const stats = this.poolRegistry.getStats();

      this.setPoolGauges('shared', stats.shared);
      this.setPoolGauges('metadata', stats.metadata);

      for (const vip of stats.vipPools) {
        // Pool name: vip-<first 8 chars of tenant ID>
        const poolName = `vip-${vip.tenantId.slice(0, 8)}`;
        this.setPoolGauges(poolName, vip);
      }
    } catch (err) {
      this.logger.warn('Failed to collect pool metrics:', (err as Error).message);
    }
  }

  private setPoolGauges(
    poolName: string,
    stats: { total: number; idle: number; waiting: number }
  ): void {
    this.prometheus.dbPoolTotal.set({ pool_name: poolName }, stats.total);
    this.prometheus.dbPoolIdle.set({ pool_name: poolName }, stats.idle);
    this.prometheus.dbPoolWaiting.set({ pool_name: poolName }, stats.waiting);
  }
}
