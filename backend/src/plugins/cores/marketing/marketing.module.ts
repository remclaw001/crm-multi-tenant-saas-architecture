import { Module } from '@nestjs/common';
import { MarketingCore } from './marketing.core';
import { MarketingController } from './marketing.controller';

@Module({
  controllers: [MarketingController],
  providers: [MarketingCore],
  exports: [MarketingCore],
})
export class MarketingModule {}
