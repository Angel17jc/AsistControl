import { Module } from '@nestjs/common';
import { AttendanceEventsPublisher } from './attendance-events.publisher';
import { AttendanceProcessingService } from './attendance-processing.service';
import { AttendanceController } from './attendance.controller';
import { AttendanceScheduler } from './attendance.scheduler';
import { AttendanceService } from './attendance.service';
import { WorkCalendarService } from './work-calendar.service';

@Module({
  controllers: [AttendanceController],
  providers: [
    AttendanceService,
    AttendanceProcessingService,
    AttendanceEventsPublisher,
    WorkCalendarService,
    AttendanceScheduler,
  ],
  exports: [AttendanceProcessingService, AttendanceEventsPublisher],
})
export class AttendanceModule {}
