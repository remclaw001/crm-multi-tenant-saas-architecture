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
  UsePipes,
  ValidationPipe,
  Query,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentTenant } from '../../../gateway/decorators/current-tenant.decorator';
import { CurrentUser } from '../../../gateway/decorators/current-tenant.decorator';
import type { ResolvedTenant } from '../../../gateway/dto/resolved-tenant.dto';
import type { JwtClaims } from '../../../gateway/dto/jwt-claims.dto';
import { ExecutionContextBuilder } from '../../context/execution-context-builder.service';
import { SandboxService } from '../../sandbox/sandbox.service';
import {
  CustomerDataCore,
  UpdateCustomerInput,
  ListCustomersFilter,
} from './customer-data.core';
import { CreateCustomerDto } from './dto/create-customer.dto';

const PLUGIN_NAME = 'customer-data';

@Controller('api/v1/plugins/customer-data')
export class CustomerDataController {
  constructor(
    private readonly core: CustomerDataCore,
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

  @Get('customers')
  async listCustomers(
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser()   user: JwtClaims,
    @Req()           req: Request & { correlationId?: string },
    @Query('name')    name?: string,
    @Query('company') company?: string,
    @Query('phone')   phone?: string,
    @Query('status')  status?: 'active' | 'inactive' | 'all',
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const safeStatus = (['active', 'inactive', 'all'] as const).includes(status as any)
      ? (status as 'active' | 'inactive' | 'all')
      : undefined;
    const filter: ListCustomersFilter = { name, company, phone, status: safeStatus };
    const customers = await this.sandbox.execute(
      () => this.core.listCustomers(ctx, filter),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: customers, count: customers.length };
  }

  @Get('customers/:id')
  async getCustomer(
    @Param('id') id: string,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const customer = await this.sandbox.execute(
      () => this.core.getCustomer(ctx, id),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: customer };
  }

  @Post('customers')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async createCustomer(
    @Body() body: CreateCustomerDto,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const customer = await this.sandbox.execute(
      () => this.core.createCustomer(ctx, body),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: customer };
  }

  @Put('customers/:id')
  async updateCustomer(
    @Param('id') id: string,
    @Body() body: UpdateCustomerInput,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    const customer = await this.sandbox.execute(
      () => this.core.updateCustomer(ctx, id, body),
      this.core.manifest.limits.timeoutMs,
    );
    return { plugin: PLUGIN_NAME, data: customer };
  }

  @Delete('customers/:id')
  @HttpCode(204)
  async deleteCustomer(
    @Param('id') id: string,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.buildCtx(tenant, user, req);
    await this.sandbox.execute(
      () => this.core.deleteCustomer(ctx, id),
      this.core.manifest.limits.timeoutMs,
    );
  }
}
