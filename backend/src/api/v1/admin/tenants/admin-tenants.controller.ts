import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query,
  HttpCode, UseGuards,
} from '@nestjs/common';
import { SuperAdminGuard } from '../guards/super-admin.guard';
import { AdminTenantsService, TenantStatus } from './admin-tenants.service';

@Controller('api/v1/admin/tenants')
@UseGuards(SuperAdminGuard)
export class AdminTenantsController {
  constructor(private readonly tenantsService: AdminTenantsService) {}

  @Get()
  list(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('search') search?: string,
  ) {
    return this.tenantsService.list({ page: Number(page), limit: Number(limit), search });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tenantsService.findOne(id);
  }

  @Post()
  create(@Body() body: { name: string; subdomain: string; plan: string }) {
    return this.tenantsService.create(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: { name?: string; status?: TenantStatus; plan?: string },
  ) {
    return this.tenantsService.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async offboard(@Param('id') id: string): Promise<void> {
    await this.tenantsService.offboard(id);
  }

  @Get(':id/plugins')
  getPlugins(@Param('id') id: string) {
    return this.tenantsService.getPlugins(id);
  }

  @Patch(':tenantId/plugins/:pluginId')
  togglePlugin(
    @Param('tenantId') tenantId: string,
    @Param('pluginId') pluginId: string,
    @Body() body: { enabled: boolean },
  ) {
    return this.tenantsService.togglePlugin(tenantId, pluginId, body.enabled);
  }
}
