// ============================================================
// PluginInfraModule — @Global() shared plugin infrastructure
//
// Provides singleton services needed by EVERY plugin core module:
//   PluginRegistryService   — register/lookup plugin cores
//   ExecutionContextBuilder — builds per-request context
//   HookRegistryService     — hook execution
//   SandboxService          — timeout wrapper
//
// @Global() means these providers are available everywhere without
// explicit import. Must be imported by PluginsModule to ensure it
// is registered in the DI container.
//
// NestJS DI order in PluginsModule.imports:
//   [PluginInfraModule, CustomerDataModule, ...]
//   → PluginInfraModule is instantiated first
//   → its providers enter the global container
//   → CustomerDataCore can inject PluginRegistryService ✓
// ============================================================
import { Global, Module } from '@nestjs/common';
import { PluginRegistryService } from './registry/plugin-registry.service';
import { ExecutionContextBuilder } from './context/execution-context-builder.service';
import { HookRegistryService } from './hooks/hook-registry.service';
import { SandboxService } from './sandbox/sandbox.service';

@Global()
@Module({
  providers: [
    PluginRegistryService,
    ExecutionContextBuilder,
    HookRegistryService,
    SandboxService,
  ],
  exports: [
    PluginRegistryService,
    ExecutionContextBuilder,
    HookRegistryService,
    SandboxService,
  ],
})
export class PluginInfraModule {}
