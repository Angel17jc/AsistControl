import { Module } from '@nestjs/common';
import { WorkCalendarService } from '../attendance/work-calendar.service';
import { VacationsController } from './vacations.controller';
import { VacationsService } from './vacations.service';

@Module({
  controllers: [VacationsController],
  providers: [VacationsService, WorkCalendarService],
  exports: [VacationsService],
})
export class VacationsModule {}
