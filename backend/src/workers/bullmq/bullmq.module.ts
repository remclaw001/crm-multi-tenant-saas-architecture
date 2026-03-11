// ============================================================
// BullMqModule — registers Redis connection + queues + processors.
//
// Uses the same REDIS_URL as ioredis (DalModule) — BullMQ maintains
// its own connection internally via ioredis.
// ============================================================
import { Module }      from '@nestjs/common';
import { BullModule }  from '@nestjs/bullmq';
import { config }      from '../../config/env';
import { QUEUE_EMAIL, QUEUE_WEBHOOK, QUEUE_VIP_MIGRATION, QUEUE_VIP_DECOMMISSION, QUEUE_DATA_EXPORT, QUEUE_VIP_SHARED_CLEANUP, QUEUE_PLUGIN_INIT, QUEUE_AUTOMATION_ACTIONS } from './queue.constants';
import { EmailProcessor }             from './processors/email.processor';
import { WebhookRetryProcessor }      from './processors/webhook-retry.processor';
import { VipMigrationProcessor }      from './processors/vip-migration.processor';
import { VipDecommissionProcessor }   from './processors/vip-decommission.processor';
import { DataExportProcessor }        from './processors/data-export.processor';
import { VipSharedCleanupProcessor }  from './processors/vip-shared-cleanup.processor';
import { PluginInitProcessor }        from '../../plugins/init/plugin-init.processor';
// AutomationActionProcessor lives in AutomationModule (needs ActionRegistry from same module)

@Module({
  imports: [
    BullModule.forRoot({
      connection: { url: config.REDIS_URL },
    }),
    BullModule.registerQueue(
      { name: QUEUE_EMAIL },
      { name: QUEUE_WEBHOOK },
      { name: QUEUE_VIP_MIGRATION,      defaultJobOptions: { attempts: 1 } },
      { name: QUEUE_VIP_DECOMMISSION,   defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } } },
      { name: QUEUE_DATA_EXPORT,        defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 3000 } } },
      { name: QUEUE_VIP_SHARED_CLEANUP, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 60_000 } } },
      { name: QUEUE_PLUGIN_INIT,           defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 3000 } } },
      { name: QUEUE_AUTOMATION_ACTIONS,    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } } },
    ),
  ],
  providers: [EmailProcessor, WebhookRetryProcessor, VipMigrationProcessor, VipDecommissionProcessor, DataExportProcessor, VipSharedCleanupProcessor, PluginInitProcessor],
  exports:   [BullModule],  // re-export so consumers can InjectQueue
})
export class BullMqModule {}
