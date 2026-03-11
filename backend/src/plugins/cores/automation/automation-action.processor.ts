import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Inject } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { Knex } from 'knex';
import { QUEUE_AUTOMATION_ACTIONS } from '../../../workers/bullmq/queue.constants';
import { TenantContext } from '../../../dal/context/TenantContext';
import { ActionRegistry } from './action-registry';
import type { AutomationActionJobData } from './automation-action.poller';

@Processor(QUEUE_AUTOMATION_ACTIONS, { concurrency: 1 })
export class AutomationActionProcessor extends WorkerHost {
  private readonly logger = new Logger(AutomationActionProcessor.name);

  constructor(
    @Inject('KNEX_INSTANCE') private readonly knex: Knex,
    private readonly actionRegistry: ActionRegistry,
  ) {
    super();
  }

  async process(job: Job<AutomationActionJobData>): Promise<void> {
    const { eventId, tenantId, triggerId, actionType, actionParams, triggerContext } = job.data;

    // Mark processing first
    await this.knex('automation_action_events')
      .where({ id: eventId })
      .update({ status: 'processing', attempts: this.knex.raw('attempts + 1') });

    // Load tenant for TenantContext
    const tenant = await this.knex('tenants')
      .where({ id: tenantId })
      .select('id', 'tier')
      .first();

    if (!tenant) {
      await this.markFailed(eventId, `Tenant ${tenantId} not found`);
      return;
    }

    await TenantContext.run({ tenantId, tenantTier: tenant.tier }, async () => {
      const handler = this.actionRegistry.getHandler(actionType);
      await handler.execute(
        { tenantId, eventId, triggerId, triggerContext },
        actionParams,
      );
    });

    await this.knex('automation_action_events')
      .where({ id: eventId })
      .update({ status: 'completed', completed_at: this.knex.raw('NOW()') });

    this.logger.debug(`[AutomationActionProcessor] Completed event ${eventId} (${actionType})`);
  }

  async onFailed(job: Job<AutomationActionJobData>, error: Error): Promise<void> {
    await this.markFailed(job.data.eventId, error.message);
  }

  private async markFailed(eventId: string, errorMessage: string): Promise<void> {
    await this.knex('automation_action_events')
      .where({ id: eventId })
      .update({ status: 'failed', last_error: errorMessage.slice(0, 2000) });
  }
}
