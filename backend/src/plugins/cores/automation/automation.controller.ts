// ============================================================
// AutomationController — REST endpoints for automation plugin
//
// Routes: GET  /api/v1/plugins/automation/triggers
//         POST /api/v1/plugins/automation/triggers
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
import { AutomationCore, CreateTriggerInput } from './automation.core';

const PLUGIN_NAME = 'automation';

@Controller('api/v1/plugins/automation')
export class AutomationController {
  constructor(
    private readonly core: AutomationCore,
    private readonly contextBuilder: ExecutionContextBuilder,
    private readonly sandbox: SandboxService,
  ) {}

  @Get('triggers')
  async listTriggers(
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.contextBuilder.build(tenant, user, req.correlationId ?? 'n/a');

    if (!ctx.enabledPlugins.includes(PLUGIN_NAME)) {
      throw new ForbiddenException(`Plugin "${PLUGIN_NAME}" is not enabled for this tenant`);
    }

    const triggers = await this.sandbox.execute(
      () => this.core.listTriggers(ctx),
      this.core.manifest.limits.timeoutMs,
    );

    return { plugin: PLUGIN_NAME, data: triggers, count: triggers.length };
  }

  @Post('triggers')
  async createTrigger(
    @Body() body: CreateTriggerInput,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.contextBuilder.build(tenant, user, req.correlationId ?? 'n/a');

    if (!ctx.enabledPlugins.includes(PLUGIN_NAME)) {
      throw new ForbiddenException(`Plugin "${PLUGIN_NAME}" is not enabled for this tenant`);
    }

    const trigger = await this.sandbox.execute(
      () => this.core.createTrigger(ctx, body),
      this.core.manifest.limits.timeoutMs,
    );

    return { plugin: PLUGIN_NAME, data: trigger };
  }
}
