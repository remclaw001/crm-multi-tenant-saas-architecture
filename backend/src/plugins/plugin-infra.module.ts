// ============================================================
// PluginInfraModule — @Global() shared plugin infrastructure
//
// Provides singleton services needed by EVERY plugin core module:
//   PluginRegistryService    — register/lookup plugin cores
//   ExecutionContextBuilder  — builds per-request context
//   HookRegistryService      — hook execution
//   SandboxService           — timeout wrapper (built-in trusted cores)
//   IsolatedSandboxService   — V8 isolate wrapper (external plugins, Phase 6)
//
// Imports ObservabilityModule so PrometheusService is available
// for IsolatedSandboxService to record sandbox metrics.
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
import { ObservabilityModule } from '../observability/observability.module';
import { PluginRegistryService } from './registry/plugin-registry.service';
import { ExecutionContextBuilder } from './context/execution-context-builder.service';
import { HookRegistryService } from './hooks/hook-registry.service';
import { SandboxService } from './sandbox/sandbox.service';
import { IsolatedSandboxService } from './sandbox/isolated-sandbox.service';
import { PLUGIN_MANIFESTS } from './manifest/plugin-manifests.token';
import { PluginDependencyService } from './deps/plugin-dependency.service';
import { BUILT_IN_MANIFESTS } from './manifest/built-in-manifests';

@Global()
@Module({
  imports: [
    // ObservabilityModule exports PrometheusService, needed by IsolatedSandboxService
    ObservabilityModule,
  ],
  providers: [
    { provide: PLUGIN_MANIFESTS, useValue: BUILT_IN_MANIFESTS },
    PluginDependencyService,
    PluginRegistryService,
    ExecutionContextBuilder,
    HookRegistryService,
    SandboxService,
    IsolatedSandboxService,
  ],
  exports: [
    PLUGIN_MANIFESTS,
    PluginDependencyService,
    PluginRegistryService,
    ExecutionContextBuilder,
    HookRegistryService,
    SandboxService,
    IsolatedSandboxService,
  ],
})
export class PluginInfraModule {}
