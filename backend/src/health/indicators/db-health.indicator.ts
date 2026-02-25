// ============================================================
// DbHealthIndicator — kiểm tra kết nối PostgreSQL
//
// Dùng metadata pool (không cần tenant context) để ping DB.
// Trả về thống kê pool: total connections, idle, waiting.
// ============================================================
import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { Pool } from 'pg';
import { config } from '../../config/env';

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: config.DATABASE_METADATA_URL ?? config.DATABASE_URL,
      max: 2,
      connectionTimeoutMillis: 3_000,
    });
  }
  return _pool;
}

@Injectable()
export class DbHealthIndicator extends HealthIndicator {
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const pool = getPool();

    try {
      const start = Date.now();
      await pool.query('SELECT 1');
      const latencyMs = Date.now() - start;

      return this.getStatus(key, true, {
        latencyMs,
        totalConnections: pool.totalCount,
        idleConnections: pool.idleCount,
        waitingRequests: pool.waitingCount,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown DB error';
      throw new HealthCheckError(
        'Database check failed',
        this.getStatus(key, false, { error })
      );
    }
  }
}
