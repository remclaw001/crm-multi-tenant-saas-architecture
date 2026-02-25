// ============================================================
// RedisHealthIndicator — kiểm tra kết nối Redis
//
// Dùng một ioredis connection riêng cho health check.
// Gửi PING → chờ PONG, đo latency.
// ============================================================
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import Redis from 'ioredis';
import { config } from '../../config/env';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator implements OnModuleDestroy {
  private readonly client: Redis;

  constructor() {
    super();
    this.client = new Redis(config.REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 3_000,
      // Không retry vô hạn — health check phải nhanh
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const start = Date.now();
      const pong = await this.client.ping();
      const latencyMs = Date.now() - start;

      if (pong !== 'PONG') {
        throw new Error(`Unexpected PING response: ${pong}`);
      }

      return this.getStatus(key, true, { latencyMs });
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown Redis error';
      throw new HealthCheckError(
        'Redis check failed',
        this.getStatus(key, false, { error })
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
