import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { Knex } from 'knex';
import { QUEUE_PLUGIN_EVENTS } from '../../../workers/bullmq/queue.constants';
import { TenantContext, type TenantTier } from '../../../dal/context/TenantContext';
import { AutomationCore } from './automation.core';
import { ExecutionContextBuilder } from '../../context/execution-context-builder.service';

export interface PluginEventJobData {
  eventId:    string;
  eventName:  string;
  tenantId:   string;
  tenantTier: TenantTier;
  payload:    Record<string, unknown>;
}

@Processor(QUEUE_PLUGIN_EVENTS, { concurrency: 1 })
export class AutomationEventProcessor extends WorkerHost {
  private readonly logger = new Logger(AutomationEventProcessor.name);

  constructor(
    @Inject('KNEX_INSTANCE') private readonly knex: Knex,
    private readonly automationCore: AutomationCore,
    private readonly contextBuilder: ExecutionContextBuilder,
  ) {
    super();
  }

  async process(job: Job<PluginEventJobData>): Promise<void> {
    const { eventId, eventName, tenantId, tenantTier, payload } = job.data;

    await TenantContext.run({ tenantId, tenantTier }, async () => {
      const ctx = await this.contextBuilder.buildForWorker(tenantId, tenantTier, eventId);
      await this.automationCore.fireTriggerEvents(ctx, eventName, payload);
    });

    await this.knex('plugin_events')
      .where({ id: eventId })
      .update({ status: 'processed' });

    this.logger.debug(`[AutomationEventProcessor] processed event ${eventId} (${eventName})`);
  }

  async onFailed(job: Job<PluginEventJobData>, error: Error): Promise<void> {
    const maxAttempts = job.opts?.attempts ?? 1;
    if (job.attemptsMade >= maxAttempts) {
      this.logger.warn(
        `[AutomationEventProcessor] event ${job.data.eventId} exhausted retries — resetting to pending`,
      );
      await this.knex('plugin_events')
        .where({ id: job.data.eventId })
        .update({ status: 'pending', queued_at: null });
    }
  }
}
