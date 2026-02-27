// ============================================================
// AmqpModule — @Global() RabbitMQ infrastructure module.
//
// Exports AmqpService + AmqpPublisher so any module can inject
// AmqpPublisher without explicitly importing AmqpModule.
//
// AmqpTopologyService runs in onModuleInit to declare exchanges
// and queues BEFORE consumers start (consumers are in WorkersModule
// which imports AmqpModule, so topology is ready first).
// ============================================================
import { Global, Module } from '@nestjs/common';
import { AmqpService }          from './amqp.service';
import { AmqpTopologyService }  from './amqp-topology.service';
import { AmqpPublisher }        from './amqp-publisher.service';

@Global()
@Module({
  providers: [AmqpService, AmqpTopologyService, AmqpPublisher],
  exports:   [AmqpService, AmqpPublisher],
})
export class AmqpModule {}
