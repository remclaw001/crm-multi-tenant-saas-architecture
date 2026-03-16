// ============================================================
// EventInfraModule — @Global() event infrastructure
//
// Provides singleton services for event handling:
//   EventRegistryService  — register/emit plugin events
//   EventPollerService    — poll event registry
//
// Registers BullMQ queue for QUEUE_PLUGIN_EVENTS (producer side).
// AutomationModule will register the same queue again as a consumer
// in Task 9 — this double registration is the standard BullMQ pattern.
//
// @Global() means EventRegistryService is available everywhere
// without explicit import. Must be imported by PluginInfraModule
// to ensure it is registered in the DI container.
// ============================================================
import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EventRegistryService } from './event-registry.service';
import { EventPollerService } from './event-poller.service';
import { QUEUE_PLUGIN_EVENTS } from '../../workers/bullmq/queue.constants';

@Global()
@Module({
  imports: [
    BullModule.registerQueue({
      name: QUEUE_PLUGIN_EVENTS,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    }),
  ],
  providers: [
    EventRegistryService,
    EventPollerService,
  ],
  exports: [
    EventRegistryService,
  ],
})
export class EventInfraModule {}
