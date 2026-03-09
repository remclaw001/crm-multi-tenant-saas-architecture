// ============================================================
// TenantConfigReloadService — Redis pub/sub subscriber
//
// Listens for tier-change broadcasts published by AdminTenantsService
// so every app instance keeps its in-memory state consistent.
//
// Channels:
//   crm:config:reload    — { tenantId, newTier }
//     → TenantQuotaEnforcer.updateCap() on this instance
//
//   crm:cache:invalidate — { tenantId, scope }
//     → Redis keys already deleted by the publishing instance.
//       In a multi-instance setup this would also purge any local
//       in-process caches (e.g. LRU config maps).
//
// Why a dedicated connection?
//   ioredis enters "subscriber mode" after the first subscribe()
//   call and can only execute subscribe/unsubscribe/psubscribe after
//   that point.  The shared REDIS_CLIENT must remain usable for
//   regular SET/GET/PUBLISH calls, so we open a separate connection.
// ============================================================
import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Logger,
} from '@nestjs/common';
import Redis from 'ioredis';
import { config } from '../../config/env';
import { TenantQuotaEnforcer } from '../pool/TenantQuotaEnforcer';

export const CONFIG_RELOAD_CHANNEL    = 'crm:config:reload';
export const CACHE_INVALIDATE_CHANNEL = 'crm:cache:invalidate';

interface ConfigReloadMessage  { tenantId: string; newTier: string }
interface CacheInvalidateMessage { tenantId: string; scope: string }

@Injectable()
export class TenantConfigReloadService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(TenantConfigReloadService.name);
  private subscriber: Redis | null = null;

  onApplicationBootstrap(): void {
    this.subscriber = new Redis(config.REDIS_URL, {
      lazyConnect:       false,
      enableReadyCheck:  true,
      maxRetriesPerRequest: null, // subscriber connections should retry indefinitely
    });

    this.subscriber.on('error', (err: Error) =>
      this.logger.error('Subscriber connection error', err.message),
    );

    this.subscriber.subscribe(
      CONFIG_RELOAD_CHANNEL,
      CACHE_INVALIDATE_CHANNEL,
      (err) => {
        if (err) {
          this.logger.error('Failed to subscribe to config channels', err);
        } else {
          this.logger.log(
            `Subscribed to [${CONFIG_RELOAD_CHANNEL}, ${CACHE_INVALIDATE_CHANNEL}]`,
          );
        }
      },
    );

    this.subscriber.on('message', (channel: string, raw: string) => {
      this.handleMessage(channel, raw);
    });
  }

  onApplicationShutdown(): void {
    this.subscriber?.disconnect();
    this.subscriber = null;
  }

  private handleMessage(channel: string, raw: string): void {
    try {
      const data = JSON.parse(raw) as Record<string, string>;

      if (channel === CONFIG_RELOAD_CHANNEL) {
        const { tenantId, newTier } = data as ConfigReloadMessage;
        if (!tenantId || !newTier) return;

        // Keep this instance's in-memory connection cap in sync
        TenantQuotaEnforcer.updateCap(tenantId, newTier);
        this.logger.debug(
          `[config:reload] tenant=${tenantId} newTier=${newTier}`,
        );
      }

      if (channel === CACHE_INVALIDATE_CHANNEL) {
        const { tenantId, scope } = data as CacheInvalidateMessage;
        // Redis keys are already deleted by the publishing instance.
        // Log for observability; extend here for in-process LRU caches.
        this.logger.debug(
          `[cache:invalidate] tenant=${tenantId} scope=${scope}`,
        );
      }
    } catch {
      this.logger.warn(`Failed to parse message on ${channel}: ${raw}`);
    }
  }
}
