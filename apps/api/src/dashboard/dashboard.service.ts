import { Injectable } from '@nestjs/common';
import type { DashboardSummary } from '@asistcontrol/shared';
import { DateTime } from 'luxon';
import { EVENT_WITH_RELATIONS, toEventPayload } from '../attendance/attendance-events.publisher';
import { WorkCalendarService } from '../attendance/work-calendar.service';
import { AccessScopeService } from '../common/access/access-scope.service';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { localDayBounds, toDbDate, todayIn } from '../common/utils/date-only';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

/**
 * "Right now" view of the company. Absent/pending are computed live against today's
 * schedules (records for absences only exist once the day is closed).
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: AccessScopeService,
    private readonly settings: SettingsService,
    private readonly calendars: WorkCalendarService,
  ) {}

  async summary(user: AuthenticatedUser, now = new Date()): Promise<DashboardSummary> {
    const [timezone, policy] = await Promise.all([
      this.settings.getTimezone(),
      this.settings.getAttendancePolicy(),
    ]);
    const today = todayIn(timezone, now);
    const bounds = localDayBounds(today, timezone);
    const scoped = this.scope.employeeWhere(user) ?? {};
    const employeeWhere = { AND: [scoped, { deletedAt: null, status: 'ACTIVE' as const }] };
    const monthStart = DateTime.fromISO(today, { zone: 'utc' }).startOf('month').toISODate()!;

    const [
      employees,
      records,
      leavesNow,
      events,
      overtimeMonth,
      pendingLeave,
      pendingOvertime,
      devices,
    ] = await Promise.all([
      this.prisma.employee.findMany({ where: employeeWhere, select: { id: true } }),
      this.prisma.attendanceRecord.findMany({
        where: { workDate: toDbDate(today), employee: employeeWhere },
        select: { employeeId: true, firstIn: true, lateMinutes: true, status: true },
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          status: 'APPROVED',
          startsAt: { lte: now },
          endsAt: { gt: now },
          employee: employeeWhere,
        },
        select: { employeeId: true },
      }),
      this.prisma.attendanceEvent.findMany({
        where: {
          occurredAt: { gte: bounds.from, lt: bounds.to },
          voidedAt: null,
          ...(this.scope.isUnrestricted(user) ? {} : { employee: scoped }),
        },
        orderBy: { occurredAt: 'desc' },
        ...EVENT_WITH_RELATIONS,
      }),
      this.prisma.overtimeRecord.aggregate({
        where: {
          workDate: { gte: toDbDate(monthStart), lte: toDbDate(today) },
          status: { not: 'REJECTED' },
          employee: scoped,
        },
        _sum: { minutes: true },
      }),
      this.prisma.leaveRequest.count({ where: { status: 'PENDING', employee: scoped } }),
      this.prisma.overtimeRecord.count({ where: { status: 'PENDING', employee: scoped } }),
      this.prisma.device.groupBy({ by: ['status'], where: { deletedAt: null }, _count: true }),
    ]);

    const calendar = await this.calendars.load({
      employeeIds: employees.map((e) => e.id),
      from: today,
      to: today,
      timezone,
      policy,
    });
    const recordByEmployee = new Map(records.map((r) => [r.employeeId, r]));
    const onLeave = new Set(leavesNow.map((l) => l.employeeId));

    const attendance = { present: 0, late: 0, absent: 0, onLeave: 0, pendingArrival: 0 };
    let scheduledToday = 0;
    for (const { id } of employees) {
      const day = calendar.dayFor(id, today);
      const record = recordByEmployee.get(id);
      if (record?.firstIn) {
        attendance.present++;
        if (record.lateMinutes > 0) attendance.late++;
        if (day.shift) scheduledToday++;
        continue;
      }
      if (!day.shift || day.dayType !== 'WORKDAY') continue;
      scheduledToday++;
      if (onLeave.has(id) || record?.status === 'ON_LEAVE') attendance.onLeave++;
      else if (now.getTime() > day.shift.start.getTime() + day.shift.lateToleranceMinutes * 60_000)
        attendance.absent++;
      else attendance.pendingArrival++;
    }

    const hourly = new Map<number, number>();
    for (const e of events) {
      const hour = DateTime.fromJSDate(e.occurredAt, { zone: timezone }).hour;
      hourly.set(hour, (hourly.get(hour) ?? 0) + 1);
    }
    const deviceCount = (status: string) => devices.find((d) => d.status === status)?._count ?? 0;

    return {
      date: today,
      timezone,
      employees: { active: employees.length, scheduledToday },
      attendance,
      overtimeMinutesMonth: overtimeMonth._sum.minutes ?? 0,
      pendingRequests: { leave: pendingLeave, overtime: pendingOvertime },
      devices: {
        total: devices.reduce((s, d) => s + d._count, 0),
        online: deviceCount('ONLINE') + deviceCount('SYNCING'),
        offline: deviceCount('OFFLINE'),
        error: deviceCount('ERROR'),
      },
      hourlyPunches: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        count: hourly.get(hour) ?? 0,
      })),
      latestEvents: events.slice(0, 15).map(toEventPayload),
    };
  }
}
