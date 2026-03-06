import { Controller, Get, UseGuards } from '@nestjs/common';
import { SuperAdminGuard } from '../guards/super-admin.guard';
import { AdminMetricsService } from './admin-metrics.service';

@Controller('api/v1/admin/metrics')
@UseGuards(SuperAdminGuard)
export class AdminMetricsController {
  constructor(private readonly metricsService: AdminMetricsService) {}

  @Get('summary')
  getSummary() {
    return this.metricsService.getSummary();
  }
}
