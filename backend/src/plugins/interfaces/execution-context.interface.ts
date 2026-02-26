// ============================================================
// IExecutionContext — per-request execution context
//
// Built by ExecutionContextBuilder at the start of each plugin
// request. Carries everything the plugin core needs:
//   - Tenant identity + config
//   - Enabled plugins for this tenant
//   - Authenticated user identity + roles
//   - Scoped DB and cache accessors
//
// L3 plugin code only sees this interface — never raw Knex,
// Pool, or ioredis. Complies with DIP.
// ============================================================
import type { IDbContext } from '../../dal/interfaces/IDbContext';
import type { ICacheManager } from '../../dal/interfaces/ICacheManager';

export interface IExecutionContext {
  readonly tenantId: string;
  readonly tenantTier: string;
  readonly tenantConfig: Record<string, unknown>;

  /** Names of plugins enabled for this tenant (from tenant_plugins table) */
  readonly enabledPlugins: string[];

  /** JWT sub claim — authenticated user UUID */
  readonly userId: string;
  readonly userRoles: string[];

  /** Correlation ID propagated from CorrelationIdMiddleware */
  readonly requestId: string;

  /** Tenant-scoped DB access — QueryInterceptor sets app.tenant_id automatically */
  readonly db: IDbContext;

  /** Tenant-scoped cache — key pattern t:<tenantId>:<resource>:<id> */
  readonly cache: ICacheManager;
}
