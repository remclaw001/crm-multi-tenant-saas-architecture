// ============================================================
// CustomerCareController — REST endpoints for customer-care plugin
//
// Routes: GET  /api/v1/plugins/customer-care/cases
//         POST /api/v1/plugins/customer-care/cases
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
import { CustomerCareCore, CreateCaseInput } from './customer-care.core';

const PLUGIN_NAME = 'customer-care';

@Controller('api/v1/plugins/customer-care')
export class CustomerCareController {
  constructor(
    private readonly core: CustomerCareCore,
    private readonly contextBuilder: ExecutionContextBuilder,
    private readonly sandbox: SandboxService,
  ) {}

  @Get('cases')
  async listCases(
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.contextBuilder.build(tenant, user, req.correlationId ?? 'n/a');

    if (!ctx.enabledPlugins.includes(PLUGIN_NAME)) {
      throw new ForbiddenException(`Plugin "${PLUGIN_NAME}" is not enabled for this tenant`);
    }

    const cases = await this.sandbox.execute(
      () => this.core.listCases(ctx),
      this.core.manifest.limits.timeoutMs,
    );

    return { plugin: PLUGIN_NAME, data: cases, count: cases.length };
  }

  @Post('cases')
  async createCase(
    @Body() body: CreateCaseInput,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.contextBuilder.build(tenant, user, req.correlationId ?? 'n/a');

    if (!ctx.enabledPlugins.includes(PLUGIN_NAME)) {
      throw new ForbiddenException(`Plugin "${PLUGIN_NAME}" is not enabled for this tenant`);
    }

    const newCase = await this.sandbox.execute(
      () => this.core.createCase(ctx, body),
      this.core.manifest.limits.timeoutMs,
    );

    return { plugin: PLUGIN_NAME, data: newCase };
  }
}
