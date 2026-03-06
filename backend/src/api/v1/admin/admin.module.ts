import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { config } from '../../../config/env';
import { SuperAdminGuard } from './guards/super-admin.guard';
import { AdminAuthController } from './admin-auth/admin-auth.controller';
import { AdminAuthService } from './admin-auth/admin-auth.service';
import { AdminTenantsController } from './tenants/admin-tenants.controller';
import { AdminTenantsService } from './tenants/admin-tenants.service';
import { AdminMetricsController } from './metrics/admin-metrics.controller';
import { AdminMetricsService } from './metrics/admin-metrics.service';

@Module({
  imports: [
    JwtModule.register({
      secret: config.JWT_SECRET_FALLBACK ?? (() => {
        throw new Error('JWT_SECRET_FALLBACK is required. Set it in .env (min 32 chars).');
      })(),
      signOptions: { expiresIn: '24h', algorithm: 'HS256' },
    }),
  ],
  controllers: [
    AdminAuthController,
    AdminTenantsController,
    AdminMetricsController,
  ],
  providers: [
    SuperAdminGuard,
    AdminAuthService,
    AdminTenantsService,
    AdminMetricsService,
  ],
})
export class AdminModule {}
