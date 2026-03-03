import { Module } from '@nestjs/common';
import { AutomationCore } from './automation.core';
import { AutomationController } from './automation.controller';

// Note: AutomationCore also injects HookRegistryService, which is not listed here
// because it is provided globally by PluginInfraModule (@Global decorator).
@Module({
  controllers: [AutomationController],
  providers: [AutomationCore],
  exports: [AutomationCore],
})
export class AutomationModule {}
