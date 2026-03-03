import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentTenant } from '../gateway/decorators/current-tenant.decorator';
import { CurrentUser } from '../gateway/decorators/current-tenant.decorator';
import type { ResolvedTenant } from '../gateway/dto/resolved-tenant.dto';
import type { JwtClaims } from '../gateway/dto/jwt-claims.dto';
import { ExecutionContextBuilder } from './context/execution-context-builder.service';

@Controller('api/v1/plugins')
export class PluginsListController {
  constructor(private readonly contextBuilder: ExecutionContextBuilder) {}

  @Get()
  async getEnabledPlugins(
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.contextBuilder.build(tenant, user, req.correlationId ?? 'n/a');
    return { enabledPlugins: ctx.enabledPlugins };
  }
}
