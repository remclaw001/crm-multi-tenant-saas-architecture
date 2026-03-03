import { Injectable, OnModuleInit } from '@nestjs/common';
import { ANALYTICS_MANIFEST } from '../../manifest/built-in-manifests';
import type { IPluginCore } from '../../interfaces/plugin-core.interface';
import type { PluginManifest } from '../../interfaces/plugin-manifest.interface';
import type { IExecutionContext } from '../../interfaces/execution-context.interface';
import { PluginRegistryService } from '../../registry/plugin-registry.service';

export interface AnalyticsSummary {
  totalCustomers: number;
  activeCustomers: number;
  tenantId: string;
  generatedAt: string;
}

export interface TrendPoint {
  date: string;
  count: number;
}

@Injectable()
export class AnalyticsCore implements IPluginCore, OnModuleInit {
  readonly manifest: PluginManifest = ANALYTICS_MANIFEST;

  constructor(private readonly registry: PluginRegistryService) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async summary(ctx: IExecutionContext): Promise<AnalyticsSummary> {
    const [totalRow, activeRow] = await Promise.all([
      ctx.db.db('customers').count<{ count: string }>('id as count').first(),
      ctx.db.db('customers').count<{ count: string }>('id as count').where({ is_active: true }).first(),
    ]);

    return {
      totalCustomers: parseInt(totalRow?.count ?? '0', 10),
      activeCustomers: parseInt(activeRow?.count ?? '0', 10),
      tenantId: ctx.tenantId,
      generatedAt: new Date().toISOString(),
    };
  }

  async trends(ctx: IExecutionContext): Promise<TrendPoint[]> {
    const rows = await ctx.db
      .db('customers')
      .select(
        ctx.db.db.raw("DATE(created_at) as date"),
        ctx.db.db.raw("COUNT(id) as count"),
      )
      .where('created_at', '>=', ctx.db.db.raw("NOW() - INTERVAL '30 days'"))
      .groupByRaw('DATE(created_at)')
      .orderBy('date', 'asc') as Array<{ date: string; count: string }>;

    return rows.map((r) => ({ date: r.date, count: parseInt(r.count, 10) }));
  }
}
