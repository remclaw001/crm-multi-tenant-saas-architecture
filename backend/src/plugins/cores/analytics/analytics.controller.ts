// ============================================================
// AnalyticsController — REST endpoints for analytics plugin
//
// Routes: GET /api/v1/plugins/analytics/reports/:type
//   type = 'summary' → aggregate counts
//   type = 'trends'  → daily trend data
// ============================================================
import {
  Controller,
  Get,
  Param,
  ForbiddenException,
  BadRequestException,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentTenant } from '../../../gateway/decorators/current-tenant.decorator';
import { CurrentUser } from '../../../gateway/decorators/current-tenant.decorator';
import type { ResolvedTenant } from '../../../gateway/dto/resolved-tenant.dto';
import type { JwtClaims } from '../../../gateway/dto/jwt-claims.dto';
import { ExecutionContextBuilder } from '../../context/execution-context-builder.service';
import { SandboxService } from '../../sandbox/sandbox.service';
import { AnalyticsCore } from './analytics.core';

const PLUGIN_NAME = 'analytics';
const VALID_REPORT_TYPES = ['summary', 'trends'] as const;
type ReportType = (typeof VALID_REPORT_TYPES)[number];

@Controller('api/v1/plugins/analytics')
export class AnalyticsController {
  constructor(
    private readonly core: AnalyticsCore,
    private readonly contextBuilder: ExecutionContextBuilder,
    private readonly sandbox: SandboxService,
  ) {}

  @Get('reports/:type')
  async getReport(
    @Param('type') type: string,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    if (!VALID_REPORT_TYPES.includes(type as ReportType)) {
      throw new BadRequestException(
        `Unknown report type "${type}". Valid types: ${VALID_REPORT_TYPES.join(', ')}`,
      );
    }

    const ctx = await this.contextBuilder.build(tenant, user, req.correlationId ?? 'n/a');

    if (!ctx.enabledPlugins.includes(PLUGIN_NAME)) {
      throw new ForbiddenException(`Plugin "${PLUGIN_NAME}" is not enabled for this tenant`);
    }

    const reportType = type as ReportType;

    const data = await this.sandbox.execute(
      () => (reportType === 'summary' ? this.core.summary(ctx) : this.core.trends(ctx)) as Promise<unknown>,
      this.core.manifest.limits.timeoutMs,
    );

    return { plugin: PLUGIN_NAME, reportType, data };
  }
}
