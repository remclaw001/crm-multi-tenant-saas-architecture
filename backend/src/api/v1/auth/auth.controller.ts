import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { Public } from '../../../gateway/decorators/public.decorator';
import { CurrentUser } from '../../../gateway/decorators/current-tenant.decorator';
import type { JwtClaims } from '../../../gateway/dto/jwt-claims.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @Public()
  login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  @Post('refresh')
  @HttpCode(200)
  @Public()
  refresh(@Body() body: RefreshDto) {
    return this.authService.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: JwtClaims): Promise<void> {
    if (user.jti && user.exp) {
      await this.authService.logout(user.jti, user.exp);
    }
  }
}
