import { Module } from '@nestjs/common';
import { AnalyticsCore } from './analytics.core';
import { AnalyticsController } from './analytics.controller';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsCore],
  exports: [AnalyticsCore],
})
export class AnalyticsModule {}
