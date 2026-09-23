import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { Device, DeviceStatus, Prisma } from '@prisma/client';
import { AuditService, diff } from '../audit/audit.service';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { DeviceConnectionManager } from './device-connection.manager';
import { describeDeviceError, statusAfterFailure } from './device-errors';
import type { CreateDeviceDto, UpdateDeviceDto } from './devices.dto';

/** Public representation: secrets are replaced by a flag, internals are hidden. */
export function toDeviceResponse(device: Device) {
  const { credentialsEncrypted, syncLockedAt: _lock, deletedAt: _deleted, ...rest } = device;
  return { ...rest, hasCredentials: credentialsEncrypted !== null };
}

@Injectable()
export class DevicesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DevicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: DeviceConnectionManager,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  /** Re-establish live subscriptions after a restart. */
  async onApplicationBootstrap(): Promise<void> {
    const devices = await this.prisma.device.findMany({
      where: { deletedAt: null, status: { not: 'DISABLED' } },
    });
    for (const device of devices) {
      await this.connections
        .startRealtime(device)
        .catch((err: unknown) => this.logger.warn({ err }, 'Realtime start failed'));
    }
  }

  async list() {
    const devices = await this.prisma.device.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
    });
    return devices.map(toDeviceResponse);
  }

  async get(id: string) {
    return toDeviceResponse(await this.getEntity(id));
  }

  async getEntity(id: string): Promise<Device> {
    const device = await this.prisma.device.findFirst({ where: { id, deletedAt: null } });
    if (!device) throw new NotFoundException('Device not found');
    return device;
  }

  supportedDrivers() {
    return this.connections.supportedDrivers();
  }

  async create(dto: CreateDeviceDto, actor: AuthenticatedUser, ctx: RequestContext) {
    this.assertDriver(dto.driver);
    await this.assertAddressFree(dto.host, dto.port);

    const { credentials, config, ...data } = dto;
    const device = await this.prisma.$transaction(async (tx) => {
      const created = await tx.device.create({
        data: {
          ...data,
          config: (config ?? {}) as Prisma.InputJsonValue,
          credentialsEncrypted: credentials
            ? this.connections.encryptCredentials(credentials)
            : null,
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'create',
          entity: 'Device',
          entityId: created.id,
          context: ctx,
          metadata: { ...data, config, hasCredentials: Boolean(credentials) },
        },
        tx,
      );
      return created;
    });
    await this.connections.startRealtime(device);
    return toDeviceResponse(device);
  }

  async update(id: string, dto: UpdateDeviceDto, actor: AuthenticatedUser, ctx: RequestContext) {
    const before = await this.getEntity(id);
    if (dto.driver) this.assertDriver(dto.driver);
    if (dto.host || dto.port)
      await this.assertAddressFree(dto.host ?? before.host, dto.port ?? before.port, id);

    const { credentials, config, enabled, ...data } = dto;
    let status: DeviceStatus | undefined;
    if (enabled === false) status = 'DISABLED';
    else if (enabled === true && before.status === 'DISABLED') status = 'OFFLINE';

    const device = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.device.update({
        where: { id },
        data: {
          ...data,
          status,
          config: config
            ? ({ ...(before.config as object), ...config } as Prisma.InputJsonValue)
            : undefined,
          credentialsEncrypted: credentials
            ? this.connections.encryptCredentials(credentials)
            : undefined,
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'update',
          entity: 'Device',
          entityId: id,
          context: ctx,
          metadata: diff(toDeviceResponse(before), { ...data, config, status }),
        },
        tx,
      );
      if (credentials) {
        await this.audit.record(
          {
            actorId: actor.id,
            action: 'device.credentials_changed',
            entity: 'Device',
            entityId: id,
            context: ctx,
          },
          tx,
        );
      }
      return updated;
    });

    await this.connections.release(id);
    await this.connections.startRealtime(device);
    if (status) this.emitStatus(device);
    return toDeviceResponse(device);
  }

  /** Soft delete: past punches keep pointing at the device that captured them. */
  async remove(id: string, actor: AuthenticatedUser, ctx: RequestContext): Promise<void> {
    const device = await this.getEntity(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.device.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'DISABLED' },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'delete',
          entity: 'Device',
          entityId: id,
          context: ctx,
          metadata: { name: device.name, host: device.host },
        },
        tx,
      );
    });
    await this.connections.release(id);
  }

  /**
   * Probes the device and records the outcome as its current status. It connects directly,
   * instead of through the adapter's boolean testConnection(), to keep the reason of a
   * failure: a rejected password must not be reported as a network problem.
   */
  async testConnection(id: string) {
    const device = await this.getEntity(id);
    if (device.status === 'DISABLED') throw new BadRequestException('Device is disabled');
    this.assertDriver(device.driver);

    const adapter = this.connections.adapterFor(device);
    const startedAt = Date.now();
    let info: Awaited<ReturnType<typeof adapter.getDeviceInfo>> | null = null;
    let error: string | null = null;
    let status: DeviceStatus = 'ONLINE';
    try {
      if (!adapter.isConnected()) await adapter.connect();
      info = await adapter.getDeviceInfo();
    } catch (e) {
      error = describeDeviceError(e);
      status = statusAfterFailure(e);
    }
    const latencyMs = Date.now() - startedAt;

    const updated = await this.setStatus(id, status, error, {
      lastSeenAt: error ? undefined : new Date(),
      serialNumber: info?.serialNumber,
    });
    if (!error) await this.connections.startRealtime(updated);

    return {
      reachable: error === null,
      latencyMs,
      error,
      info: info && {
        ...info,
        clockDriftSeconds: Math.round((info.deviceTime.getTime() - Date.now()) / 1000),
      },
    };
  }

  /** Single entry point for status changes so the dashboard is always notified. */
  async setStatus(
    id: string,
    status: DeviceStatus,
    lastError: string | null,
    extra: Partial<
      Pick<Device, 'lastSeenAt' | 'lastSyncAt' | 'lastSyncCursor' | 'serialNumber'>
    > = {},
  ): Promise<Device> {
    const device = await this.prisma.device.update({
      where: { id },
      data: { status, lastError, ...extra },
    });
    this.emitStatus(device);
    return device;
  }

  private emitStatus(device: Device): void {
    this.realtime.deviceStatusChanged({
      deviceId: device.id,
      name: device.name,
      status: device.status,
      lastError: device.lastError,
      lastSyncAt: device.lastSyncAt?.toISOString() ?? null,
    });
  }

  private assertDriver(driver: string): void {
    if (!this.connections.isSupported(driver)) {
      throw new BadRequestException(
        `Driver "${driver}" is not available. Supported: ${this.connections.supportedDrivers().join(', ') || 'none'}`,
      );
    }
  }

  private async assertAddressFree(host: string, port: number, exceptId?: string): Promise<void> {
    const clash = await this.prisma.device.findFirst({
      where: { host, port, deletedAt: null, NOT: exceptId ? { id: exceptId } : undefined },
    });
    if (clash) throw new ConflictException(`Device "${clash.name}" already uses ${host}:${port}`);
  }
}
