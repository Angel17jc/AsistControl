import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { DevicesModule } from '../devices/devices.module';
import { DeviceSyncController } from './device-sync.controller';
import { DeviceSyncScheduler } from './device-sync.scheduler';
import { DeviceSyncService } from './device-sync.service';

@Module({
  imports: [DevicesModule, AttendanceModule],
  controllers: [DeviceSyncController],
  providers: [DeviceSyncService, DeviceSyncScheduler],
})
export class DeviceSyncModule {}
