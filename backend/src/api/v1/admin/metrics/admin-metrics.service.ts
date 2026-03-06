import { Injectable } from '@nestjs/common';
import { PoolRegistry } from '../../../../dal/pool/PoolRegistry';

@Injectable()
export class AdminMetricsService {
  constructor(private readonly poolRegistry: PoolRegistry) {}

  async getSummary() {
    const client = await this.poolRegistry.acquireMetadataConnection();
    try {
      const res = await client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM tenants WHERE is_active = true AND subdomain != 'system'`,
      );
      const activeTenantsCount = Number(res.rows[0].count);

      // Use PoolRegistry.getStats() to compute DB pool utilization
      let dbPoolUtilization = 0;
      try {
        const stats = this.poolRegistry.getStats();
        const shared = stats.shared;
        const maxShared = 200; // matches DATABASE_POOL_MAX default
        if (maxShared > 0) {
          const used = shared.total - shared.idle;
          dbPoolUtilization = Math.round((used / maxShared) * 100);
        }
      } catch { /* pool stats unavailable */ }

      return {
        activeTenantsCount,
        requestsPerMinute: 0,
        avgResponseTimeMs: 0,
        errorRate: 0,
        dbPoolUtilization,
        cacheHitRate: 0,
      };
    } finally {
      client.release();
    }
  }
}
