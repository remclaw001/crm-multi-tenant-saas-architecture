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
import { CustomerCareCore, CreateCaseInput, UpdateCaseInput } from './customer-care.core';

const PLUGIN_NAME = 'customer-care';

@Controller('api/v1/plugins/customer-care')
export class CustomerCareController {
  constructor(
    private readonly core: CustomerCareCore,
    private readonly contextBuilder: ExecutionContextBuilder,
    private readonly sandbox: SandboxService,
  ) {}

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

  @Get('cases')
  async listCases(
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const cases = await this.sandbox.execute(
      () => this.core.listCases(ctx),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: cases, count: cases.length };
  }

  @Get('cases/:id')
  async getCase(
    @Param('id') id: string,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const c = await this.sandbox.execute(
      () => this.core.getCase(ctx, id),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: c };
  }

  @Post('cases')
  async createCase(
    @Body() body: CreateCaseInput,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const newCase = await this.sandbox.execute(
      () => this.core.createCase(ctx, body),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: newCase };
  }

  @Put('cases/:id')
  async updateCase(
    @Param('id') id: string,
    @Body() body: UpdateCaseInput,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const updated = await this.sandbox.execute(
      () => this.core.updateCase(ctx, id, body),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: updated };
  }

  @Delete('cases/:id')
  @HttpCode(204)
  async deleteCase(
    @Param('id') id: string,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    await this.sandbox.execute(
      () => this.core.deleteCase(ctx, id),
      this.core.manifest.limits.timeoutMs,
    );
  }
}
