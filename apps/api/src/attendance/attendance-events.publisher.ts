import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AttendanceEventCreatedPayload } from '@asistcontrol/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

export const EVENT_WITH_RELATIONS = {
  include: {
    employee: {
      select: { id: true, firstName: true, lastName: true, employeeCode: true, supervisorId: true },
    },
    device: { select: { id: true, name: true } },
  },
} satisfies Prisma.AttendanceEventDefaultArgs;

type EventRow = Prisma.AttendanceEventGetPayload<typeof EVENT_WITH_RELATIONS>;

export function toEventPayload(e: EventRow): AttendanceEventCreatedPayload {
  return {
    id: e.id,
    occurredAt: e.occurredAt.toISOString(),
    punchType: e.punchType,
    deviceId: e.device?.id ?? null,
    deviceName: e.device?.name ?? null,
    deviceUserId: e.deviceUserId,
    employee: e.employee
      ? {
          id: e.employee.id,
          fullName: `${e.employee.firstName} ${e.employee.lastName}`,
          employeeCode: e.employee.employeeCode,
        }
      : null,
  };
}

/** Pushes freshly stored punches to the dashboards allowed to see them. */
@Injectable()
export class AttendanceEventsPublisher {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async publishCreated(eventIds: string[]): Promise<void> {
    if (eventIds.length === 0) return;
    const events = await this.prisma.attendanceEvent.findMany({
      where: { id: { in: eventIds } },
      orderBy: { occurredAt: 'asc' },
      ...EVENT_WITH_RELATIONS,
    });
    for (const event of events) {
      this.realtime.attendanceEventCreated(toEventPayload(event), {
        employeeId: event.employee?.id ?? null,
        supervisorId: event.employee?.supervisorId ?? null,
      });
    }
  }
}
