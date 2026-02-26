import { Module } from '@nestjs/common';
import { AutomationCore } from './automation.core';
import { AutomationController } from './automation.controller';

@Module({
  controllers: [AutomationController],
  providers: [AutomationCore],
  exports: [AutomationCore],
})
export class AutomationModule {}
