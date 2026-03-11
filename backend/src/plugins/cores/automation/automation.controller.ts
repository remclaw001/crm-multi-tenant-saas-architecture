import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  HttpCode,
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
import { AutomationCore, CreateTriggerInput, UpdateTriggerInput } from './automation.core';
import { ActionRegistry } from './action-registry';

const PLUGIN_NAME = 'automation';

@Controller('api/v1/plugins/automation')
export class AutomationController {
  constructor(
    private readonly core: AutomationCore,
    private readonly contextBuilder: ExecutionContextBuilder,
    private readonly sandbox: SandboxService,
    private readonly actionRegistry: ActionRegistry,
  ) {}

  @Get('actions')
  async getAvailableActions(
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const actions = this.actionRegistry.getAvailableFor(ctx.enabledPlugins);
    return { plugin: PLUGIN_NAME, data: actions };
  }

  private async buildCtx(
    tenant: ResolvedTenant,
    user: JwtClaims,
    req: Request & { correlationId?: string },
  ) {
    const ctx = await this.contextBuilder.build(tenant, user, req.correlationId ?? 'n/a');
    if (!ctx.enabledPlugins.includes(PLUGIN_NAME)) {
      throw new ForbiddenException(`Plugin "${PLUGIN_NAME}" is not enabled for this tenant`);
    }
    return ctx;
  }

  @Get('triggers')
  async listTriggers(
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const triggers = await this.sandbox.execute(
      () => this.core.listTriggers(ctx),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: triggers, count: triggers.length };
  }

  @Get('triggers/:id')
  async getTrigger(
    @Param('id') id: string,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const trigger = await this.sandbox.execute(
      () => this.core.getTrigger(ctx, id),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: trigger };
  }

  @Post('triggers')
  async createTrigger(
    @Body() body: CreateTriggerInput,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const trigger = await this.sandbox.execute(
      () => this.core.createTrigger(ctx, body),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: trigger };
  }

  @Put('triggers/:id')
  async updateTrigger(
    @Param('id') id: string,
    @Body() body: UpdateTriggerInput,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const updated = await this.sandbox.execute(
      () => this.core.updateTrigger(ctx, id, body),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: updated };
  }

  @Delete('triggers/:id')
  @HttpCode(204)
  async deleteTrigger(
    @Param('id') id: string,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    await this.sandbox.execute(
      () => this.core.deleteTrigger(ctx, id),
      this.core.manifest.limits.timeoutMs,
    );
  }
}
