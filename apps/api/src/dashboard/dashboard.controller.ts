import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @RequirePermissions('dashboard:read')
  @ApiOperation({
    summary: 'KPIs for today: present, late, absent, overtime, devices, latest punches',
  })
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboard.summary(user);
  }
}
