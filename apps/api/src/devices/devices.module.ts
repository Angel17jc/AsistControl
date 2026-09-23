import { Module } from '@nestjs/common';
import { WorkCalendarService } from '../attendance/work-calendar.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { adapterProviders } from './adapters.provider';
import { DeviceConnectionManager } from './device-connection.manager';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { DeviceSimulationService } from './simulation/device-simulation.service';

@Module({
  imports: [NotificationsModule],
  controllers: [DevicesController],
  providers: [
    ...adapterProviders,
    DeviceConnectionManager,
    DevicesService,
    DeviceSimulationService,
    WorkCalendarService,
  ],
  exports: [DevicesService, DeviceConnectionManager],
})
export class DevicesModule {}
