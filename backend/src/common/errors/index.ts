// ============================================================
// L6 Error Hierarchy — Barrel export
// ============================================================
export { AppError } from './app.error';

export {
  DomainError,
  TenantNotFoundError,
  TenantInactiveError,
  PluginDisabledError,
  PermissionDeniedError,
  ResourceNotFoundError,
  ConflictError,
} from './domain.errors';

export {
  PluginError,
  PluginTimeoutError,
  PluginQueryLimitError,
  PluginNotFoundError,
  PluginExecutionError,
} from './plugin.errors';

export { ValidationError } from './validation.errors';
export { PluginDependencyError } from '../../plugins/deps/plugin-dependency.error';
