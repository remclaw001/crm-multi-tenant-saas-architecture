// ============================================================
// CustomerDataController — REST endpoints for customer-data plugin
//
// Routes: GET  /api/v1/plugins/customer-data/contacts
//         GET  /api/v1/plugins/customer-data/contacts/:id
//
// Flow per action:
//   1. Decorators extract tenant + user from request (set by middleware/guard)
//   2. ExecutionContextBuilder assembles per-request context
//   3. Check plugin is enabled for this tenant → 403 if not
//   4. SandboxService wraps core call with 5s timeout
// ============================================================
import {
  Controller,
  Get,
  Param,
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
import { CustomerDataCore } from './customer-data.core';

const PLUGIN_NAME = 'customer-data';

@Controller('api/v1/plugins/customer-data')
export class CustomerDataController {
  constructor(
    private readonly core: CustomerDataCore,
    private readonly contextBuilder: ExecutionContextBuilder,
    private readonly sandbox: SandboxService,
  ) {}

  @Get('contacts')
  async listContacts(
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.contextBuilder.build(tenant, user, req.correlationId ?? 'n/a');

    if (!ctx.enabledPlugins.includes(PLUGIN_NAME)) {
      throw new ForbiddenException(`Plugin "${PLUGIN_NAME}" is not enabled for this tenant`);
    }

    const contacts = await this.sandbox.execute(
      () => this.core.listContacts(ctx),
      this.core.manifest.limits.timeoutMs,
    );

    return { plugin: PLUGIN_NAME, data: contacts, count: contacts.length };
  }

  @Get('contacts/:id')
  async getContact(
    @Param('id') id: string,
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request & { correlationId?: string },
  ) {
    const ctx = await this.contextBuilder.build(tenant, user, req.correlationId ?? 'n/a');

    if (!ctx.enabledPlugins.includes(PLUGIN_NAME)) {
      throw new ForbiddenException(`Plugin "${PLUGIN_NAME}" is not enabled for this tenant`);
    }

    const contact = await this.sandbox.execute(
      () => this.core.getContact(ctx, id),
      this.core.manifest.limits.timeoutMs,
    );

    return { plugin: PLUGIN_NAME, data: contact };
  }
}
