// ============================================================
// ApiModule — business routes aggregator
//
// Phase 3: chỉ có ApiV1Module (placeholder routes)
// Phase 5+: mỗi plugin Core sẽ có module riêng:
//   CustomerDataModule, CustomerCareModule, AnalyticsModule, etc.
// ============================================================
import { Module } from '@nestjs/common';
import { ApiV1Module } from './v1/api-v1.module';

@Module({
  imports: [ApiV1Module],
})
export class ApiModule {}
