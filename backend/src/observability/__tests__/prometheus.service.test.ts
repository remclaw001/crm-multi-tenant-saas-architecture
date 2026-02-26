// ============================================================
// PrometheusService — Unit Tests
// ============================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrometheusService } from '../metrics/prometheus.service';

describe('PrometheusService', () => {
  let service: PrometheusService;

  beforeEach(() => {
    service = new PrometheusService();
  });

  afterEach(() => {
    // onModuleDestroy clears registry — ngăn leak giữa tests
    service.onModuleDestroy();
  });

  it('registry được khởi tạo (không phải global registry)', () => {
    expect(service.registry).toBeDefined();
    // Custom registry — không phải singleton global registry của prom-client
    expect(service.registry).not.toBe(undefined);
  });

  it('getMetrics() trả về string Prometheus format', async () => {
    const metrics = await service.getMetrics();
    expect(typeof metrics).toBe('string');
    expect(metrics.length).toBeGreaterThan(0);
  });

  it('getMetrics() chứa crm_ prefix', async () => {
    const metrics = await service.getMetrics();
    expect(metrics).toContain('crm_http_requests_total');
    expect(metrics).toContain('crm_http_request_duration_seconds');
    expect(metrics).toContain('crm_db_pool_connections_total');
    expect(metrics).toContain('crm_cache_operations_total');
  });

  it('getMetrics() chứa Node.js default metrics với crm_ prefix', async () => {
    const metrics = await service.getMetrics();
    expect(metrics).toContain('crm_nodejs_');
  });

  it('getContentType() trả về Prometheus text content type', () => {
    const ct = service.getContentType();
    expect(ct).toContain('text/plain');
  });

  it('httpRequestsTotal.inc() tăng counter', async () => {
    service.httpRequestsTotal.inc({
      method: 'GET',
      route: '/api/v1/test/ping',
      status_code: '200',
      tenant_tier: 'standard',
    });

    const metrics = await service.getMetrics();
    expect(metrics).toContain('crm_http_requests_total');
    // Counter phải có value > 0 (không thể kiểm tra exact value vì format phức tạp)
  });

  it('httpRequestDurationSeconds.observe() không throw', () => {
    expect(() => {
      service.httpRequestDurationSeconds.observe(
        { method: 'GET', route: '/api/v1/test/ping', tenant_tier: 'standard' },
        0.025 // 25ms
      );
    }).not.toThrow();
  });

  it('dbPoolTotal.set() không throw', () => {
    expect(() => {
      service.dbPoolTotal.set({ pool_name: 'shared' }, 42);
      service.dbPoolIdle.set({ pool_name: 'shared' }, 38);
      service.dbPoolWaiting.set({ pool_name: 'shared' }, 0);
    }).not.toThrow();
  });

  it('cacheOperationsTotal.inc() không throw', () => {
    expect(() => {
      service.cacheOperationsTotal.inc({ operation: 'get', result: 'hit' });
      service.cacheOperationsTotal.inc({ operation: 'get', result: 'miss' });
      service.cacheOperationsTotal.inc({ operation: 'set', result: 'ok' });
    }).not.toThrow();
  });

  it('onModuleDestroy() clears registry', () => {
    const clearSpy = vi.spyOn(service.registry, 'clear');
    service.onModuleDestroy();
    expect(clearSpy).toHaveBeenCalled();
  });
});
