import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AutomationCore } from './automation.core';
import { AutomationController } from './automation.controller';
import { ActionRegistry } from './action-registry';
import { WebhookCallHandler } from './handlers/webhook-call.handler';
import { CustomerUpdateFieldHandler } from './handlers/customer-update-field.handler';
import { CaseCreateHandler } from './handlers/case-create.handler';
import { AutomationActionPoller } from './automation-action.poller';
import { AutomationActionProcessor } from './automation-action.processor';
import { AutomationEventProcessor } from './automation-event.processor';
import { QUEUE_AUTOMATION_ACTIONS, QUEUE_PLUGIN_EVENTS } from '../../../workers/bullmq/queue.constants';

@Module({
  imports: [
    // Register the queue tokens here so processors and pollers can @InjectQueue
    BullModule.registerQueue({ name: QUEUE_AUTOMATION_ACTIONS }),
    BullModule.registerQueue({ name: QUEUE_PLUGIN_EVENTS }),
  ],
  controllers: [AutomationController],
  providers: [
    AutomationCore,
    ActionRegistry,
    WebhookCallHandler,
    CustomerUpdateFieldHandler,
    CaseCreateHandler,
    AutomationActionPoller,
    AutomationActionProcessor,
    AutomationEventProcessor,
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
