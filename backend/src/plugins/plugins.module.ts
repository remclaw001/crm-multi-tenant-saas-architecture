// ============================================================
// PluginsModule — L3 Business Logic aggregator
//
// Imports:
//   1. PluginInfraModule (@Global) — registers shared singletons
//      (PluginRegistryService, ExecutionContextBuilder,
//       HookRegistryService, SandboxService) into the global
//       DI container BEFORE any core module is instantiated.
//
//   2. Core modules — each core's OnModuleInit registers itself
//      with PluginRegistryService via constructor injection.
//
// DalModule is @Global() so PoolRegistry, CacheManager, KNEX_INSTANCE
// are available here without explicit import.
// ============================================================
import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { PluginInfraModule } from './plugin-infra.module';
import { CustomerDataModule } from './cores/customer-data/customer-data.module';
import { CustomerCareModule } from './cores/customer-care/customer-care.module';
import { AnalyticsModule } from './cores/analytics/analytics.module';
import { AutomationModule } from './cores/automation/automation.module';
import { MarketingModule } from './cores/marketing/marketing.module';
import { PluginsListController } from './plugins-list.controller';
import { PluginDependencyService } from './deps/plugin-dependency.service';

@Module({
  imports: [
    // PluginInfraModule FIRST — populates global container before cores are instantiated
    PluginInfraModule,
    CustomerDataModule,
    CustomerCareModule,
    AnalyticsModule,
    AutomationModule,
    MarketingModule,
  ],
  controllers: [PluginsListController],
})
export class PluginsModule implements OnModuleInit {
  private readonly logger = new Logger(PluginsModule.name);

  constructor(private readonly deps: PluginDependencyService) {}

  onModuleInit(): void {
    const issues = this.deps.validateGraph();
    for (const issue of issues) {
      this.logger.warn(`[PluginDependency] ${issue.type}: ${issue.detail}`);
    }
  }
}
