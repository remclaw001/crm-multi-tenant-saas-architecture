// ============================================================
// PluginManifest — static descriptor for every plugin
//
// Each built-in core declares a manifest constant in
// manifest/built-in-manifests.ts. Third-party plugins would
// load theirs from plugin.manifest.json (Phase 6+).
// ============================================================

export type HookType = 'before' | 'after' | 'filter';

export interface PluginHookDef {
  /** Event name, e.g. 'customer.create', 'deal.update' */
  event: string;
  type: HookType;
  /** Lower number = higher priority = runs first */
  priority: number;
}

export interface PluginResourceLimits {
  /** Max execution time in ms before GatewayTimeoutException (default 5000) */
  timeoutMs: number;
  /** Max memory in MB (enforced by Sandbox Engine) */
  memoryMb: number;
  /** Max DB queries per request (enforced by QueryCounter) */
  maxQueries: number;
}

export interface PluginManifest {
  /** Unique identifier — matches plugin_name in tenant_plugins table */
  name: string;
  version: string;
  description: string;
  /** Names of other plugins this plugin depends on */
  dependencies: string[];
  /** Permission strings required by this plugin */
  permissions: string[];
  limits: PluginResourceLimits;
  hooks: PluginHookDef[];
}
