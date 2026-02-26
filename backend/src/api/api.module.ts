// ============================================================
// ApiModule — business routes aggregator
//
// Phase 3: ApiV1Module (placeholder ping routes)
// Phase 5: PluginsModule — 5 plugin cores with real endpoints
// ============================================================
import { Module } from '@nestjs/common';
import { ApiV1Module } from './v1/api-v1.module';
import { PluginsModule } from '../plugins/plugins.module';

@Module({
  imports: [ApiV1Module, PluginsModule],
})
export class ApiModule {}
