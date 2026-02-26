import { Module } from '@nestjs/common';
import { CustomerDataCore } from './customer-data.core';
import { CustomerDataController } from './customer-data.controller';

@Module({
  controllers: [CustomerDataController],
  providers: [CustomerDataCore],
  exports: [CustomerDataCore],
})
export class CustomerDataModule {}
