import { Module } from '@nestjs/common';
import { AttendanceEventsPublisher } from './attendance-events.publisher';
import { AttendanceProcessingService } from './attendance-processing.service';
import { AttendanceController } from './attendance.controller';
import { AttendanceScheduler } from './attendance.scheduler';
import { AttendanceService } from './attendance.service';
import { PresenceService } from './presence.service';
import { WorkCalendarService } from './work-calendar.service';

@Module({
  controllers: [AttendanceController],
  providers: [
    AttendanceService,
    AttendanceProcessingService,
    AttendanceEventsPublisher,
    WorkCalendarService,
    AttendanceScheduler,
    PresenceService,
  ],
  exports: [AttendanceProcessingService, AttendanceEventsPublisher],
})
export class AttendanceModule {}
