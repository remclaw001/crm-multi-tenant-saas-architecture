// ============================================================
// MarketingController — REST endpoints for marketing plugin
//
// Routes: GET  /api/v1/plugins/marketing/campaigns
//         POST /api/v1/plugins/marketing/campaigns
// ============================================================
import {
  Controller,
  Get,
  Post,
  Body,
  ForbiddenException,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentTenant } from '../../../gateway/decorators/current-tenant.decorator';
import { CurrentUser } from '../../../gateway/decorators/current-tenant.decorator';
import type { ResolvedTenant } from '../../../gateway/dto/resolved-tenant.dto';
import type { JwtClaims } from '../../../gateway/dto/jwt-claims.dto';
import { ExecutionContextBuilder } from '../../context/execution-context-builder.service';
import { SandboxService } from '../../sandbox/sandbox.service';
import { MarketingCore, CreateCampaignInput } from './marketing.core';

const PLUGIN_NAME = 'marketing';

@Controller('api/v1/plugins/marketing')
export class MarketingController {
  constructor(
    private readonly core: MarketingCore,
    private readonly contextBuilder: ExecutionContextBuilder,
    private readonly sandbox: SandboxService,
  ) {}

  @Get('campaigns')
  async listCampaigns(
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.contextBuilder.build(tenant, user, req.correlationId ?? 'n/a');

    if (!ctx.enabledPlugins.includes(PLUGIN_NAME)) {
      throw new ForbiddenException(`Plugin "${PLUGIN_NAME}" is not enabled for this tenant`);
    }

    const campaigns = await this.sandbox.execute(
      () => this.core.listCampaigns(ctx),
      this.core.manifest.limits.timeoutMs,
    );

    return { plugin: PLUGIN_NAME, data: campaigns, count: campaigns.length };
  }

  @Post('campaigns')
  async createCampaign(
    @Body() body: CreateCampaignInput,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.contextBuilder.build(tenant, user, req.correlationId ?? 'n/a');

    if (!ctx.enabledPlugins.includes(PLUGIN_NAME)) {
      throw new ForbiddenException(`Plugin "${PLUGIN_NAME}" is not enabled for this tenant`);
    }

    const campaign = await this.sandbox.execute(
      () => this.core.createCampaign(ctx, body),
      this.core.manifest.limits.timeoutMs,
    );

    return { plugin: PLUGIN_NAME, data: campaign };
  }
}
