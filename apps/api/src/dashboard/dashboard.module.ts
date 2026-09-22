import { Module } from '@nestjs/common';
import { WorkCalendarService } from '../attendance/work-calendar.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, WorkCalendarService],
})
export class DashboardModule {}
