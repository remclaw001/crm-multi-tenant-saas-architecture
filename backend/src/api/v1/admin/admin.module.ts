import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BullModule } from '@nestjs/bullmq';
import { config } from '../../../config/env';
import { QUEUE_VIP_MIGRATION, QUEUE_VIP_DECOMMISSION, QUEUE_DATA_EXPORT } from '../../../workers/bullmq/queue.constants';
import { SuperAdminGuard } from './guards/super-admin.guard';
import { AdminAuthController } from './admin-auth/admin-auth.controller';
import { AdminAuthService } from './admin-auth/admin-auth.service';
import { AdminTenantsController } from './tenants/admin-tenants.controller';
import { AdminTenantsService } from './tenants/admin-tenants.service';
import { AdminMetricsController } from './metrics/admin-metrics.controller';
import { AdminMetricsService } from './metrics/admin-metrics.service';
import { AdminUsersController } from './tenants/admin-users.controller';
import { AdminUsersService } from './tenants/admin-users.service';

@Module({
  imports: [
    JwtModule.register({
      secret: config.JWT_SECRET_FALLBACK ?? 'no-secret-configured-admin-login-will-fail',
      signOptions: { expiresIn: '24h', algorithm: 'HS256' },
    }),
    BullModule.registerQueue(
      { name: QUEUE_VIP_MIGRATION },
      { name: QUEUE_VIP_DECOMMISSION },
      { name: QUEUE_DATA_EXPORT },
    ),
  ],
  controllers: [
    AdminAuthController,
    AdminTenantsController,
    AdminMetricsController,
    AdminUsersController,
  ],
  providers: [
    SuperAdminGuard,
    AdminAuthService,
    AdminTenantsService,
    AdminMetricsService,
    AdminUsersService,
  ],
})
export class AdminModule {}
