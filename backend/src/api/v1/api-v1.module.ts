import { Module } from '@nestjs/common';
import { ApiV1Controller } from './api-v1.controller';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [AuthModule, AdminModule],
  controllers: [ApiV1Controller],
})
export class ApiV1Module {}
