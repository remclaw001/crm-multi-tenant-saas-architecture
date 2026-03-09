import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, HttpCode, UseGuards,
} from '@nestjs/common';
import { SuperAdminGuard } from '../guards/super-admin.guard';
import { AdminUsersService } from './admin-users.service';

@Controller('api/v1/admin/tenants/:tenantId/users')
@UseGuards(SuperAdminGuard)
export class AdminUsersController {
  constructor(private readonly usersService: AdminUsersService) {}

  @Get()
  list(@Param('tenantId') tenantId: string) {
    return this.usersService.listUsers(tenantId);
  }

  @Post()
  create(
    @Param('tenantId') tenantId: string,
    @Body() body: { name: string; email: string; password: string; role: 'admin' | 'manager' },
  ) {
    return this.usersService.createUser(tenantId, body);
  }

  @Patch(':userId')
  update(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @Body() body: { name?: string; email?: string; role?: 'admin' | 'manager'; password?: string },
  ) {
    return this.usersService.updateUser(tenantId, userId, body);
  }

  @Patch(':userId/disable')
  @HttpCode(200)
  setActive(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @Body() body: { is_active: boolean },
  ) {
    return this.usersService.setActive(tenantId, userId, body.is_active);
  }

  @Delete(':userId')
  @HttpCode(204)
  async remove(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.usersService.deleteUser(tenantId, userId);
  }
}
