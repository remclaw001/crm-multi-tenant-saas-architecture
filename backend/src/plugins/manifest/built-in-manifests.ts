// ============================================================
// Built-in Plugin Manifests — static descriptors for the 5 core plugins
//
// All share the same resource limits (configurable per-tenant in Phase 6).
// Dependencies declare which other plugins must be enabled.
// Permissions list what the plugin requires to function.
// ============================================================
import type { PluginManifest, PluginResourceLimits } from '../interfaces/plugin-manifest.interface';

const DEFAULT_LIMITS: PluginResourceLimits = {
  timeoutMs: 5000,
  memoryMb: 50,
  maxQueries: 50,
};

export const CUSTOMER_DATA_MANIFEST: PluginManifest = {
  name: 'customer-data',
  version: '1.0.0',
  description: 'Contact management and customer data',
  dependencies: [],
  permissions: ['customers:read', 'customers:write', 'customers:delete'],
  limits: DEFAULT_LIMITS,
  hooks: [],
};

export const CUSTOMER_CARE_MANIFEST: PluginManifest = {
  name: 'customer-care',
  version: '1.0.0',
  description: 'Support case management and customer service',
  dependencies: ['customer-data'],
  permissions: ['customers:read', 'deals:read', 'deals:write'],
  limits: DEFAULT_LIMITS,
  hooks: [
    { event: 'customer.create', type: 'after', priority: 10 },
  ],
};

export const ANALYTICS_MANIFEST: PluginManifest = {
  name: 'analytics',
  version: '1.0.0',
  description: 'Business intelligence and reporting',
  dependencies: [],
  permissions: ['analytics:view'],
  limits: DEFAULT_LIMITS,
  hooks: [],
};

export const AUTOMATION_MANIFEST: PluginManifest = {
  name: 'automation',
  version: '1.0.0',
  description: 'Workflow automation and trigger management',
  dependencies: ['customer-data', 'analytics'],
  permissions: ['customers:read', 'customers:write', 'deals:read'],
  limits: DEFAULT_LIMITS,
  hooks: [
    { event: 'customer.create', type: 'after', priority: 20 },
  ],
};

export const MARKETING_MANIFEST: PluginManifest = {
  name: 'marketing',
  version: '1.0.0',
  description: 'Campaign and email marketing management',
  dependencies: ['customer-data'],
  permissions: ['customers:read'],
  limits: DEFAULT_LIMITS,
  hooks: [],
};

export const BUILT_IN_MANIFESTS: PluginManifest[] = [
  CUSTOMER_DATA_MANIFEST,
  CUSTOMER_CARE_MANIFEST,
  ANALYTICS_MANIFEST,
  AUTOMATION_MANIFEST,
  MARKETING_MANIFEST,
];
