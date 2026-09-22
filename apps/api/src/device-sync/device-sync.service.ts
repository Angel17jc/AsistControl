import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import type { Device, Prisma, SyncStatus, SyncTrigger } from '@prisma/client';
import { type AttendanceLog, BiometricDeviceError } from '@asistcontrol/biometric-core';
import { AttendanceEventsPublisher } from '../attendance/attendance-events.publisher';
import { AttendanceProcessingService } from '../attendance/attendance-processing.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { paginate, skipTake, type PaginationQueryDto } from '../common/dto/pagination.dto';
import { DeviceConnectionManager } from '../devices/device-connection.manager';
import { DevicesService } from '../devices/devices.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { type Rejection, runIngestionPipeline } from './ingestion-pipeline';

/** A lock older than this belongs to a crashed instance and can be taken over. */
const STALE_LOCK_MS = 10 * 60_000;
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;
const REALTIME_BATCH_MS = 250;

export interface IngestionSummary {
  received: number;
  processed: number;
  duplicated: number;
  rejected: number;
  unmatched: number;
  rejections: Rejection[];
}

/**
 * Orchestrates Device → Adapter → Pipeline → Database → Attendance → WebSocket.
 * Two entry points share the same ingestion path: pull (sync) and push (realtime).
 */
@Injectable()
export class DeviceSyncService implements OnModuleInit {
  private readonly logger = new Logger(DeviceSyncService.name);
  private readonly realtimeBuffers = new Map<
    string,
    { logs: AttendanceLog[]; timer: NodeJS.Timeout }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
    private readonly connections: DeviceConnectionManager,
    private readonly processing: AttendanceProcessingService,
    private readonly publisher: AttendanceEventsPublisher,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.connections.onRealtimeLog((deviceId, log) => this.bufferRealtime(deviceId, log));
  }

  async sync(
    deviceId: string,
    trigger: SyncTrigger,
    actor?: AuthenticatedUser,
    ctx?: RequestContext,
  ) {
    const device = await this.devices.getEntity(deviceId);
    if (device.status === 'DISABLED') throw new BadRequestException('Device is disabled');
    if (!(await this.acquireLock(deviceId)))
      throw new ConflictException('A sync is already running for this device');

    const syncLog = await this.prisma.deviceSyncLog.create({ data: { deviceId, trigger } });
    await this.devices.setStatus(deviceId, 'SYNCING', null);

    let status: SyncStatus = 'FAILED';
    let summary: IngestionSummary | null = null;
    let errorMessage: string | null = null;
    const metadata: Record<string, unknown> = {};

    try {
      const adapter = this.connections.adapterFor(device);
      const { result, info } = await withRetry(async () => {
        if (!adapter.isConnected()) await adapter.connect();
        const deviceInfo = await adapter.getDeviceInfo();
        return { result: await adapter.sync({ cursor: device.lastSyncCursor }), info: deviceInfo };
      });

      const driftSeconds = Math.round((info.deviceTime.getTime() - Date.now()) / 1000);
      if (Math.abs(driftSeconds) > 60) metadata.clockDriftSeconds = driftSeconds;

      summary = await this.ingest(device, result.logs, syncLog.id);
      status = summary.rejected > 0 ? 'PARTIAL' : 'SUCCESS';
      if (summary.rejections.length > 0) metadata.rejections = summary.rejections.slice(0, 20);

      await this.devices.setStatus(deviceId, 'ONLINE', null, {
        lastSyncAt: new Date(),
        lastSeenAt: new Date(),
        lastSyncCursor: result.cursor ?? device.lastSyncCursor,
        serialNumber: info.serialNumber,
      });
    } catch (error) {
      errorMessage = describe(error);
      const unreachable = error instanceof BiometricDeviceError && error.retryable;
      await this.devices.setStatus(deviceId, unreachable ? 'OFFLINE' : 'ERROR', errorMessage);
      this.logger.warn({ deviceId, err: error }, `Device sync failed: ${errorMessage}`);
    } finally {
      await this.prisma.device.update({ where: { id: deviceId }, data: { syncLockedAt: null } });
    }

    const finished = await this.prisma.deviceSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status,
        finishedAt: new Date(),
        recordsReceived: summary?.received ?? 0,
        recordsProcessed: summary?.processed ?? 0,
        recordsDuplicated: summary?.duplicated ?? 0,
        recordsRejected: summary?.rejected ?? 0,
        recordsUnmatched: summary?.unmatched ?? 0,
        errorMessage,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });

    this.realtime.deviceSyncFinished({
      deviceId,
      syncLogId: finished.id,
      status,
      recordsReceived: finished.recordsReceived,
      recordsProcessed: finished.recordsProcessed,
      recordsDuplicated: finished.recordsDuplicated,
      recordsRejected: finished.recordsRejected,
    });
    if (actor) {
      await this.audit.record({
        actorId: actor.id,
        action: 'device.sync',
        entity: 'Device',
        entityId: deviceId,
        context: ctx,
        metadata: { syncLogId: finished.id, status },
      });
    }
    return finished;
  }

  /** Shared by pull and push: validate, store idempotently, recompute days, notify. */
  async ingest(
    device: Pick<Device, 'id'>,
    logs: AttendanceLog[],
    syncLogId: string | null,
  ): Promise<IngestionSummary> {
    const pipeline = runIngestionPipeline(logs, { deviceId: device.id, now: new Date() });

    const userIds = [...new Set(pipeline.accepted.map((l) => l.deviceUserId))];
    const employees = await this.prisma.employee.findMany({
      where: { biometricId: { in: userIds }, deletedAt: null },
      select: { id: true, biometricId: true },
    });
    const employeeByBiometric = new Map(employees.map((e) => [e.biometricId!, e.id]));

    const inserted =
      pipeline.accepted.length === 0
        ? []
        : await this.prisma.attendanceEvent.createManyAndReturn({
            data: pipeline.accepted.map((l) => ({
              employeeId: employeeByBiometric.get(l.deviceUserId) ?? null,
              deviceId: device.id,
              syncLogId,
              deviceUserId: l.deviceUserId,
              occurredAt: l.occurredAt,
              punchType: l.punchType,
              verifyMode: l.verifyMode,
              source: 'DEVICE' as const,
              dedupKey: l.dedupKey,
              rawPayload: (l.raw ?? undefined) as Prisma.InputJsonValue | undefined,
            })),
            // The unique dedup key turns "already stored" into a skipped row, not an error.
            skipDuplicates: true,
            select: { id: true, employeeId: true, occurredAt: true },
          });

    await this.processing.processEvents(inserted);
    await this.publisher.publishCreated(inserted.map((e) => e.id));

    return {
      received: logs.length,
      processed: inserted.length,
      duplicated: pipeline.duplicatesInBatch + (pipeline.accepted.length - inserted.length),
      rejected: pipeline.rejected.length,
      unmatched: inserted.filter((e) => e.employeeId === null).length,
      rejections: pipeline.rejected,
    };
  }

  async listLogs(query: PaginationQueryDto, deviceId?: string) {
    const where: Prisma.DeviceSyncLogWhereInput = { deviceId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.deviceSyncLog.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        include: { device: { select: { id: true, name: true } } },
        ...skipTake(query),
      }),
      this.prisma.deviceSyncLog.count({ where }),
    ]);
    return paginate(rows, total, query);
  }

  /** Live punches arrive one by one; group them in short batches to reuse the bulk path. */
  private bufferRealtime(deviceId: string, log: AttendanceLog): void {
    const existing = this.realtimeBuffers.get(deviceId);
    if (existing) {
      existing.logs.push(log);
      return;
    }
    const timer = setTimeout(() => void this.flushRealtime(deviceId), REALTIME_BATCH_MS);
    this.realtimeBuffers.set(deviceId, { logs: [log], timer });
  }

  private async flushRealtime(deviceId: string): Promise<void> {
    const buffer = this.realtimeBuffers.get(deviceId);
    this.realtimeBuffers.delete(deviceId);
    if (!buffer) return;
    try {
      const summary = await this.ingest({ id: deviceId }, buffer.logs, null);
      const device = await this.prisma.device.findUnique({ where: { id: deviceId } });
      if (
        device &&
        device.status !== 'ONLINE' &&
        device.status !== 'SYNCING' &&
        device.status !== 'DISABLED'
      ) {
        await this.devices.setStatus(deviceId, 'ONLINE', null, { lastSeenAt: new Date() });
      } else {
        await this.prisma.device.update({
          where: { id: deviceId },
          data: { lastSeenAt: new Date() },
        });
      }
      this.logger.debug(
        { deviceId, ...summary, rejections: undefined },
        'Realtime punches ingested',
      );
    } catch (err) {
      // Nothing is lost: the punches stay on the device and the next sync downloads them.
      this.logger.error(
        { err, deviceId },
        'Realtime ingestion failed; will be recovered by next sync',
      );
    }
  }

  private async acquireLock(deviceId: string): Promise<boolean> {
    const { count } = await this.prisma.device.updateMany({
      where: {
        id: deviceId,
        deletedAt: null,
        OR: [
          { syncLockedAt: null },
          { syncLockedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } },
        ],
      },
      data: { syncLockedAt: new Date() },
    });
    return count === 1;
  }
}

/** Retries transient device failures (timeouts, dropped connections) with exponential backoff. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = RETRY_ATTEMPTS,
  baseDelayMs = RETRY_BASE_DELAY_MS,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const retryable = error instanceof BiometricDeviceError && error.retryable;
      if (!retryable || attempt === attempts) break;
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

function describe(error: unknown): string {
  if (error instanceof BiometricDeviceError) return `${error.code}: ${error.message}`;
  return 'Unexpected error during sync';
}
