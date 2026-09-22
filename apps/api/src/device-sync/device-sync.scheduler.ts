import {
  ConflictException,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { DeviceSyncService } from './device-sync.service';

const JOB_NAME = 'device-polling';

/**
 * Periodic pull of every enabled device. Realtime push is an optimization; polling is the
 * safety net that guarantees punches stored on a device while it was offline are recovered.
 */
@Injectable()
export class DeviceSyncScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DeviceSyncScheduler.name);
  private running = false;

  constructor(
    private readonly sync: DeviceSyncService,
    private readonly prisma: PrismaService,
    private readonly registry: SchedulerRegistry,
    private readonly config: AppConfigService,
  ) {}

  onApplicationBootstrap(): void {
    const seconds = this.config.get('DEVICE_SYNC_INTERVAL_SECONDS');
    if (seconds === 0) {
      this.logger.log('Device polling disabled (DEVICE_SYNC_INTERVAL_SECONDS=0)');
      return;
    }
    const interval = setInterval(() => void this.syncAll(), seconds * 1000);
    this.registry.addInterval(JOB_NAME, interval);
    this.logger.log(`Polling devices every ${seconds}s`);
  }

  onModuleDestroy(): void {
    if (this.registry.doesExist('interval', JOB_NAME)) this.registry.deleteInterval(JOB_NAME);
  }

  async syncAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const devices = await this.prisma.device.findMany({
        where: { deletedAt: null, status: { not: 'DISABLED' } },
        select: { id: true },
      });
      // Sequential on purpose: small LAN terminals handle one client at a time poorly.
      for (const { id } of devices) {
        await this.sync.sync(id, 'SCHEDULED').catch((err: unknown) => {
          if (!(err instanceof ConflictException))
            this.logger.error({ err, deviceId: id }, 'Scheduled sync failed');
        });
      }
    } finally {
      this.running = false;
    }
  }
}
