import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AutomationCore } from './automation.core';
import { AutomationController } from './automation.controller';
import { ActionRegistry } from './action-registry';
import { WebhookCallHandler } from './handlers/webhook-call.handler';
import { CustomerUpdateFieldHandler } from './handlers/customer-update-field.handler';
import { CaseCreateHandler } from './handlers/case-create.handler';
import { AutomationActionPoller } from './automation-action.poller';
import { QUEUE_AUTOMATION_ACTIONS } from '../../../workers/bullmq/queue.constants';

// Note: AutomationActionProcessor is registered in BullMqModule — it requires
// @Processor decorator which needs the queue registered at that module level.

@Module({
  imports: [
    // Register the queue token here so AutomationActionPoller can @InjectQueue
    BullModule.registerQueue({ name: QUEUE_AUTOMATION_ACTIONS }),
  ],
  controllers: [AutomationController],
  providers: [
    AutomationCore,
    ActionRegistry,
    WebhookCallHandler,
    CustomerUpdateFieldHandler,
    CaseCreateHandler,
    AutomationActionPoller,
  ],
  exports: [AutomationCore, ActionRegistry],
})
export class AutomationModule implements OnModuleInit {
  constructor(
    private readonly actionRegistry: ActionRegistry,
    private readonly webhookHandler: WebhookCallHandler,
    private readonly customerUpdateHandler: CustomerUpdateFieldHandler,
    private readonly caseCreateHandler: CaseCreateHandler,
  ) {}

  onModuleInit(): void {
    this.actionRegistry.register(this.webhookHandler);
    this.actionRegistry.register(this.customerUpdateHandler);
    this.actionRegistry.register(this.caseCreateHandler);
  }
}
