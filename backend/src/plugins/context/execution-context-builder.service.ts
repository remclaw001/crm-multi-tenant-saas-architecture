// ============================================================
// ExecutionContextBuilder — assembles per-request ExecutionContext
//
// Called from each plugin controller action:
//   const ctx = await this.contextBuilder.build(tenant, user, requestId);
//
// Injects:
//   KNEX_INSTANCE  — Knex with QueryInterceptor (tenant-scoped queries)
//   CacheManager   — ioredis wrapper (tenant-scoped key pattern)
//   PoolRegistry   — passed to PluginRegistryService for plugin lookup
//   PluginRegistryService — loads enabled plugins for the tenant
//
// Must be called inside TenantContext.run() scope (set by
// TenantResolverMiddleware) so ALS propagates tenant_id to
// QueryInterceptor and CacheManager automatically.
// ============================================================
import { Injectable, Inject } from '@nestjs/common';
import type { Knex } from 'knex';
import { CacheManager } from '../../dal/cache/CacheManager';
import { PoolRegistry } from '../../dal/pool/PoolRegistry';
import type { IDbContext } from '../../dal/interfaces/IDbContext';
import type { ResolvedTenant } from '../../gateway/dto/resolved-tenant.dto';
import type { JwtClaims } from '../../gateway/dto/jwt-claims.dto';
import { PluginRegistryService } from '../registry/plugin-registry.service';
import { ExecutionContext } from './execution-context';

@Injectable()
export class ExecutionContextBuilder {
  constructor(
    @Inject('KNEX_INSTANCE') private readonly knex: Knex,
    private readonly cacheManager: CacheManager,
    private readonly poolRegistry: PoolRegistry,
    private readonly pluginRegistry: PluginRegistryService,
  ) {}

  async build(
    tenant: ResolvedTenant,
    user: JwtClaims,
    requestId: string,
  ): Promise<ExecutionContext> {
    const enabledPlugins = await this.pluginRegistry.getEnabledPlugins(
      tenant.id,
      this.cacheManager,
      this.poolRegistry,
    );

    // Knex already has QueryInterceptor applied — queries are automatically
    // scoped to the current tenant via TenantContext ALS → SET app.tenant_id
    const db: IDbContext = {
      db: this.knex,
      transaction: (fn) => this.knex.transaction(fn),
    };

    return new ExecutionContext(
      tenant.id,
      tenant.tier,
      {},
      enabledPlugins,
      user.sub,
      user.roles,
      requestId,
      db,
      this.cacheManager,
    );
  }
}
