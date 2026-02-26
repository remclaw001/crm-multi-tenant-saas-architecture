// ============================================================
// ExecutionContext — concrete per-request context object
//
// Built by ExecutionContextBuilder at the start of each plugin
// request and passed to all plugin core methods.
//
// Immutable POJO — all fields are set in constructor.
// ============================================================
import type { IExecutionContext } from '../interfaces/execution-context.interface';
import type { IDbContext } from '../../dal/interfaces/IDbContext';
import type { ICacheManager } from '../../dal/interfaces/ICacheManager';

export class ExecutionContext implements IExecutionContext {
  constructor(
    public readonly tenantId: string,
    public readonly tenantTier: string,
    public readonly tenantConfig: Record<string, unknown>,
    public readonly enabledPlugins: string[],
    public readonly userId: string,
    public readonly userRoles: string[],
    public readonly requestId: string,
    public readonly db: IDbContext,
    public readonly cache: ICacheManager,
  ) {}
}
