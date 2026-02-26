import { Module } from '@nestjs/common';
import { CustomerCareCore } from './customer-care.core';
import { CustomerCareController } from './customer-care.controller';

@Module({
  controllers: [CustomerCareController],
  providers: [CustomerCareCore],
  exports: [CustomerCareCore],
})
export class CustomerCareModule {}
