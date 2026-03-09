// ============================================================
// PrometheusService — prom-client registry + metric definitions
//
// Định nghĩa TẤT CẢ metrics tại một chỗ (single source of truth).
// Các service/interceptor khác inject PrometheusService để record.
//
// Metrics:
//   http_requests_total{method, route, status_code, tenant_tier}
//     → Counter: tổng số request đã xử lý
//
//   http_request_duration_seconds{method, route, tenant_tier}
//     → Histogram: phân phối latency, dùng để tính p50/p95/p99
//
//   db_pool_connections_total{pool_name}
//     → Gauge: tổng connections trong pool
//   db_pool_connections_idle{pool_name}
//     → Gauge: connections đang idle
//   db_pool_connections_waiting{pool_name}
//     → Gauge: requests đang chờ connection
//
//   cache_operations_total{operation, result}
//     → Counter: cache get/set/del với hit/miss
//
//   sandbox_execution_duration_seconds{result}   ← Phase 6
//     → Histogram: plugin execution time (success|timeout|memory_exceeded|query_limit|error)
//
//   sandbox_violations_total{limit_type}         ← Phase 6
//     → Counter: sandbox limit breaches per type (timeout|memory|query_limit)
//
// Label cardinality strategy:
//   tenant_tier (4 values: basic|premium|enterprise|vip) thay cho tenant_id
//   → giữ cardinality thấp trên high-traffic metrics
//   route = normalized path (e.g. /api/v1/:plugin/ping) thay URL thực
// ============================================================
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from 'prom-client';

// Latency histogram buckets (seconds)
// Phù hợp cho API với SLA < 500ms
const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

@Injectable()
export class PrometheusService implements OnModuleInit, OnModuleDestroy {
  readonly registry: Registry;

  // ── HTTP Metrics ───────────────────────────────────────────
  readonly httpRequestsTotal: Counter<string>;
  readonly httpRequestDurationSeconds: Histogram<string>;

  // ── DB Pool Metrics ────────────────────────────────────────
  readonly dbPoolTotal: Gauge<string>;
  readonly dbPoolIdle: Gauge<string>;
  readonly dbPoolWaiting: Gauge<string>;

  // ── Cache Metrics ──────────────────────────────────────────
  readonly cacheOperationsTotal: Counter<string>;

  // ── Sandbox Metrics (Phase 6) ──────────────────────────────
  /** Execution time of plugin scripts in V8 isolates. */
  readonly sandboxExecutionDuration: Histogram<string>;
  /** Hard-limit violations by type: timeout | memory | query_limit */
  readonly sandboxViolationsTotal: Counter<string>;

  constructor() {
    // Registry riêng biệt — không dùng global registry
    // để tránh conflict khi chạy nhiều instance trong tests
    this.registry = new Registry();

    // ── Node.js default metrics (memory, CPU, event loop lag) ─
    collectDefaultMetrics({ register: this.registry, prefix: 'crm_' });

    // ── HTTP Request Counter ────────────────────────────────
    this.httpRequestsTotal = new Counter({
      name: 'crm_http_requests_total',
      help: 'Total number of HTTP requests processed',
      labelNames: ['method', 'route', 'status_code', 'tenant_tier'],
      registers: [this.registry],
    });

    // ── HTTP Latency Histogram ──────────────────────────────
    this.httpRequestDurationSeconds = new Histogram({
      name: 'crm_http_request_duration_seconds',
      help: 'HTTP request duration in seconds (p50/p95/p99)',
      labelNames: ['method', 'route', 'tenant_tier'],
      buckets: LATENCY_BUCKETS,
      registers: [this.registry],
    });

    // ── DB Pool Gauges ──────────────────────────────────────
    this.dbPoolTotal = new Gauge({
      name: 'crm_db_pool_connections_total',
      help: 'Total connections in the pool (active + idle)',
      labelNames: ['pool_name'],
      registers: [this.registry],
    });

    this.dbPoolIdle = new Gauge({
      name: 'crm_db_pool_connections_idle',
      help: 'Idle connections available in the pool',
      labelNames: ['pool_name'],
      registers: [this.registry],
    });

    this.dbPoolWaiting = new Gauge({
      name: 'crm_db_pool_connections_waiting',
      help: 'Requests waiting for an available connection',
      labelNames: ['pool_name'],
      registers: [this.registry],
    });

    // ── Cache Operations Counter ────────────────────────────
    this.cacheOperationsTotal = new Counter({
      name: 'crm_cache_operations_total',
      help: 'Cache operations by type and result',
      labelNames: ['operation', 'result'],
      registers: [this.registry],
    });

    // ── Sandbox Metrics (Phase 6) ────────────────────────────
    // Buckets tuned for the 5 s hard timeout:
    // 100ms, 250ms, 500ms, 1s, 2s, 3s, 5s (timeout boundary)
    this.sandboxExecutionDuration = new Histogram({
      name: 'crm_sandbox_execution_duration_seconds',
      help: 'Plugin script execution time inside the V8 isolate',
      labelNames: ['result'],
      buckets: [0.1, 0.25, 0.5, 1, 2, 3, 5],
      registers: [this.registry],
    });

    this.sandboxViolationsTotal = new Counter({
      name: 'crm_sandbox_violations_total',
      help: 'Plugin sandbox limit violations by type',
      labelNames: ['limit_type'],
      registers: [this.registry],
    });
  }

  onModuleInit(): void {
    // Metrics registry sẵn sàng — log thông báo
    // (không cần làm gì thêm ở đây, metrics initialized trong constructor)
  }

  onModuleDestroy(): void {
    // Clear registry để tránh memory leak trong tests
    this.registry.clear();
  }

  /**
   * Xuất tất cả metrics ở Prometheus text format.
   * Gọi bởi MetricsController để serve GET /metrics.
   */
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  /** Content-Type cho Prometheus scraper */
  getContentType(): string {
    return this.registry.contentType;
  }
}
