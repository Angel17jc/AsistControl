import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AttendanceProcessingService } from './attendance-processing.service';

@Injectable()
export class AttendanceScheduler {
  private readonly logger = new Logger(AttendanceScheduler.name);
  private running = false;

  constructor(private readonly processing: AttendanceProcessingService) {}

  /** Hourly: closes finished work days (missing exits, absences). Idempotent. */
  @Cron(CronExpression.EVERY_HOUR, { name: 'attendance-finalizer' })
  async finalize(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.processing.finalizePendingDays();
      this.logger.log(result, 'Attendance days finalized');
    } catch (err) {
      this.logger.error({ err }, 'Attendance finalizer failed');
    } finally {
      this.running = false;
    }
  }
}
