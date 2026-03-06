import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { Public } from '../../../../gateway/decorators/public.decorator';
import { AdminAuthService, AdminLoginDto } from './admin-auth.service';

@Controller('api/v1/admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post('login')
  @HttpCode(200)
  @Public()
  login(@Body() body: AdminLoginDto) {
    return this.adminAuthService.login(body);
  }
}
