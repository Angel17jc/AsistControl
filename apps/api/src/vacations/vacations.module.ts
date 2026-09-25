import { Module } from '@nestjs/common';
import { WorkCalendarService } from '../attendance/work-calendar.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { VacationExpiryNotices } from './vacation-expiry-notices';
import { VacationsController } from './vacations.controller';
import { VacationsService } from './vacations.service';

@Module({
  imports: [NotificationsModule],
  controllers: [VacationsController],
  providers: [VacationsService, VacationExpiryNotices, WorkCalendarService],
  exports: [VacationsService],
})
export class VacationsModule {}
