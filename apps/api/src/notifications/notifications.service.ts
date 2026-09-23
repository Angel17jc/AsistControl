import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Device, LeaveRequest, Notification, Prisma } from '@prisma/client';
import {
  type AppNotification,
  type NotificationDataByType,
  type NotificationType,
  type Role,
  SCOPED_ROLES,
  rolesWith,
} from '@asistcontrol/shared';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { paginate, skipTake } from '../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { NotificationQueryDto } from './notifications.dto';

/** Notifications older than this are deleted, read or not: they are prompts, not records. */
const RETENTION_DAYS = 90;

const FAILED = new Set<Device['status']>(['OFFLINE', 'ERROR']);

/** What the platform knew about a device right before a status change. */
export type DeviceBefore = Pick<Device, 'status' | 'lastSeenAt'> | null;

/**
 * Turns domain events into notifications for the people who must act on them, stores them
 * and pushes them to their sockets. Two rules shape it (docs/adr/0007-notifications.md):
 *
 * - **Recipients come from the RBAC matrix and the row scope**, resolved when the event
 *   happens: whoever can act on a device or review a request, and nobody else.
 * - **Notifying is best effort.** The domain action (a sync, an approval) has already
 *   happened; a failure here is logged and never undoes or blocks it.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  // ── Reading: always the caller's own ────────────────────────────────────────────────────

  async list(query: NotificationQueryDto, user: AuthenticatedUser) {
    const where: Prisma.NotificationWhereInput = {
      userId: user.id,
      ...(query.unread && { readAt: null }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.notification.count({ where }),
    ]);
    return paginate(rows.map(toPayload), total, query);
  }

  async unreadCount(user: AuthenticatedUser): Promise<{ count: number }> {
    return {
      count: await this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    };
  }

  /** Idempotent: reading twice keeps the first read time. */
  async markRead(id: string, user: AuthenticatedUser): Promise<void> {
    const { count } = await this.prisma.notification.updateMany({
      where: { id, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    if (count > 0) return;
    // Someone else's notification is reported exactly like one that does not exist.
    const own = await this.prisma.notification.count({ where: { id, userId: user.id } });
    if (own === 0) throw new NotFoundException('Notification not found');
  }

  async markAllRead(user: AuthenticatedUser): Promise<{ updated: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'notifications-retention' })
  async purgeExpired(now = new Date()): Promise<number> {
    const { count } = await this.prisma.notification.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - RETENTION_DAYS * 86_400_000) } },
    });
    if (count > 0) this.logger.log(`Deleted ${count} notifications past retention`);
    return count;
  }

  // ── Producing ───────────────────────────────────────────────────────────────────────────

  /**
   * Called on every device status change. A terminal polled every few minutes fails every
   * few minutes while it is down, so this reports **incidents**, not failures: one
   * DEVICE_DOWN per outage and one DEVICE_RECOVERED when it ends. An outage starts at the
   * device's last successful contact (`lastSeenAt`), so "already reported" means a
   * DEVICE_DOWN newer than that.
   */
  async deviceStatusChanged(before: DeviceBefore, device: Device): Promise<void> {
    await this.safely(`device ${device.id}`, async () => {
      if (FAILED.has(device.status)) {
        // A terminal never reached did not go down: it was never up.
        if (!device.lastSeenAt) return;
        if (await this.downReportedSince(device.id, device.lastSeenAt)) return;
        await this.send(await this.usersWith('devices:sync'), 'DEVICE_DOWN', deviceEntity(device), {
          deviceName: device.name,
          status: device.status as 'OFFLINE' | 'ERROR',
          error: device.lastError,
        });
        return;
      }
      // Back online: only worth saying if the outage was reported in the first place.
      if (device.status === 'ONLINE' && before?.lastSeenAt) {
        if (!(await this.downReportedSince(device.id, before.lastSeenAt))) return;
        await this.send(
          await this.usersWith('devices:sync'),
          'DEVICE_RECOVERED',
          deviceEntity(device),
          {
            deviceName: device.name,
          },
        );
      }
    });
  }

  /** A new request goes to whoever may review it: HR and admins, and the direct supervisor. */
  async leaveRequested(request: LeaveRequest, actorId: string): Promise<void> {
    await this.safely(`leave request ${request.id}`, async () => {
      const employee = await this.employeeOf(request);
      const unrestricted = rolesWith('leave:approve').filter((r) => !SCOPED_ROLES.includes(r));
      const scoped = rolesWith('leave:approve').filter((r) => SCOPED_ROLES.includes(r));
      const reviewers = await this.prisma.user.findMany({
        where: {
          isActive: true,
          OR: [
            { role: { in: unrestricted } },
            ...(employee.supervisorId
              ? [{ role: { in: scoped }, employeeId: employee.supervisorId }]
              : []),
          ],
        },
        select: { id: true },
      });
      // Nobody reviews their own request, and whoever filed it already knows.
      const recipients = reviewers
        .map((u) => u.id)
        .filter((id) => id !== actorId && id !== employee.user?.id);
      await this.send(recipients, 'LEAVE_REQUESTED', leaveEntity(request), {
        employeeName: employee.name,
        leaveType: request.type,
        startsAt: request.startsAt.toISOString(),
        endsAt: request.endsAt.toISOString(),
      });
    });
  }

  /** The decision goes to the employee and to whoever filed the request for them. */
  async leaveReviewed(request: LeaveRequest, reviewerId: string): Promise<void> {
    if (request.status !== 'APPROVED' && request.status !== 'REJECTED') return;
    const decision = request.status;
    await this.safely(`leave request ${request.id}`, async () => {
      const employee = await this.employeeOf(request);
      const recipients = [employee.user?.id, request.requestedById].filter(
        (id): id is string => Boolean(id) && id !== reviewerId,
      );
      await this.send(recipients, 'LEAVE_REVIEWED', leaveEntity(request), {
        employeeName: employee.name,
        leaveType: request.type,
        startsAt: request.startsAt.toISOString(),
        endsAt: request.endsAt.toISOString(),
        decision,
        note: request.reviewNote,
      });
    });
  }

  private async send<T extends NotificationType>(
    recipients: string[],
    type: T,
    about: { entity: string; id: string },
    data: NotificationDataByType[T],
  ): Promise<void> {
    const userIds = [...new Set(recipients)];
    if (userIds.length === 0) return;
    const rows = await this.prisma.notification.createManyAndReturn({
      data: userIds.map((userId) => ({
        userId,
        type,
        data: data as Prisma.InputJsonObject,
        entity: about.entity,
        entityId: about.id,
      })),
    });
    for (const row of rows) this.realtime.notificationCreated(row.userId, toPayload(row));
  }

  private async downReportedSince(deviceId: string, since: Date): Promise<boolean> {
    const found = await this.prisma.notification.findFirst({
      where: { type: 'DEVICE_DOWN', entityId: deviceId, createdAt: { gte: since } },
      select: { id: true },
    });
    return found !== null;
  }

  private async usersWith(permission: Parameters<typeof rolesWith>[0]): Promise<string[]> {
    const roles: Role[] = rolesWith(permission);
    const users = await this.prisma.user.findMany({
      where: { isActive: true, role: { in: roles } },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  private async employeeOf(request: LeaveRequest) {
    const employee = await this.prisma.employee.findUniqueOrThrow({
      where: { id: request.employeeId },
      select: {
        firstName: true,
        lastName: true,
        supervisorId: true,
        user: { select: { id: true } },
      },
    });
    return { ...employee, name: `${employee.firstName} ${employee.lastName}` };
  }

  private async safely(subject: string, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (err) {
      this.logger.warn({ err }, `Could not notify about ${subject}`);
    }
  }
}

function deviceEntity(device: Device) {
  return { entity: 'Device', id: device.id };
}

function leaveEntity(request: LeaveRequest) {
  return { entity: 'LeaveRequest', id: request.id };
}

function toPayload(row: Notification): AppNotification {
  return {
    id: row.id,
    type: row.type,
    data: row.data,
    entity: row.entity,
    entityId: row.entityId,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  } as AppNotification;
}
