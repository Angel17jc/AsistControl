import { PRESENCE_STATES, type PresenceBoard, type PresenceState } from '@asistcontrol/shared';
import { Injectable } from '@nestjs/common';
import { AccessScopeService } from '../common/access/access-scope.service';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { todayIn } from '../common/utils/date-only';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { presenceAt } from './domain/presence';
import { WorkCalendarService } from './work-calendar.service';

/**
 * Who is in right now. Each person is judged on the work day the current moment belongs to
 * (yesterday's during a night shift past midnight), with a fixed number of queries.
 */
@Injectable()
export class PresenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: AccessScopeService,
    private readonly settings: SettingsService,
    private readonly calendars: WorkCalendarService,
  ) {}

  async board(user: AuthenticatedUser, now = new Date()): Promise<PresenceBoard> {
    const [timezone, policy] = await Promise.all([
      this.settings.getTimezone(),
      this.settings.getAttendancePolicy(),
    ]);
    const employees = await this.prisma.employee.findMany({
      where: { AND: [this.scope.employeeWhere(user) ?? {}, { deletedAt: null, status: 'ACTIVE' }] },
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        department: { select: { name: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    const counts = Object.fromEntries(PRESENCE_STATES.map((s) => [s, 0])) as Record<
      PresenceState,
      number
    >;
    const board = { at: now.toISOString(), timezone, counts, entries: [] };
    if (employees.length === 0) return board;

    const ids = employees.map((e) => e.id);
    const today = todayIn(timezone, now);
    const calendar = await this.calendars.load({
      employeeIds: ids,
      from: today,
      to: today,
      timezone,
      policy,
    });
    const days = new Map(ids.map((id) => [id, calendar.dayFor(id, calendar.workDateOf(id, now))]));
    const windows = [...days.values()].map((d) => d.window);
    const from = new Date(Math.min(...windows.map((w) => w.from.getTime())));
    const to = new Date(Math.max(...windows.map((w) => w.to.getTime())));

    const [events, leaves] = await Promise.all([
      this.prisma.attendanceEvent.findMany({
        where: { employeeId: { in: ids }, voidedAt: null, occurredAt: { gte: from, lte: now } },
        select: {
          id: true,
          employeeId: true,
          occurredAt: true,
          punchType: true,
          device: { select: { name: true } },
        },
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          employeeId: { in: ids },
          status: 'APPROVED',
          startsAt: { lt: to },
          endsAt: { gt: from },
        },
        select: { id: true, employeeId: true, type: true, startsAt: true, endsAt: true },
      }),
    ]);
    const eventsOf = groupBy(events, (e) => e.employeeId!);
    const leavesOf = groupBy(leaves, (l) => l.employeeId);

    const entries = employees.map((employee) => {
      const day = days.get(employee.id)!;
      const own = eventsOf.get(employee.id) ?? [];
      const ownLeaves = leavesOf.get(employee.id) ?? [];
      const presence = presenceAt({
        day,
        punches: own.map((e) => ({ id: e.id, at: e.occurredAt, type: e.punchType })),
        leaves: ownLeaves.map((l) => ({ id: l.id, start: l.startsAt, end: l.endsAt })),
        policy,
        now,
      });
      const last = presence.lastPunch;
      const leaveNow = ownLeaves.find((l) => l.startsAt <= now && l.endsAt > now);
      counts[presence.state]++;
      return {
        employee: {
          id: employee.id,
          employeeCode: employee.employeeCode,
          firstName: employee.firstName,
          lastName: employee.lastName,
          department: employee.department?.name ?? null,
        },
        state: presence.state,
        workDate: day.workDate,
        shift: day.shift && {
          start: day.shift.start.toISOString(),
          end: day.shift.end.toISOString(),
          breakStart: day.shift.breakStart?.toISOString() ?? null,
          breakEnd: day.shift.breakEnd?.toISOString() ?? null,
        },
        expectedStart: presence.expectedStart?.toISOString() ?? null,
        expectedEnd: presence.expectedEnd?.toISOString() ?? null,
        firstIn: presence.firstIn?.toISOString() ?? null,
        lateMinutes: presence.lateMinutes,
        lastPunch: last && {
          at: last.at.toISOString(),
          reading: last.reading,
          deviceName: own.find((e) => e.id === last.id)?.device?.name ?? null,
        },
        leaveType: leaveNow?.type ?? null,
      };
    });

    // Board order: by state as listed in PRESENCE_STATES, then by name (already sorted).
    const rank = (s: PresenceState) => PRESENCE_STATES.indexOf(s);
    return { ...board, entries: entries.sort((a, b) => rank(a.state) - rank(b.state)) };
  }
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}
