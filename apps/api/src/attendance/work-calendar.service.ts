import { Injectable } from '@nestjs/common';
import { addDays, fromDbDate, localDateOf, toDbDate } from '../common/utils/date-only';
import { PrismaService } from '../prisma/prisma.service';
import type { AttendancePolicy } from './domain/attendance-policy';
import type { WorkDayContext } from './domain/types';
import {
  type ShiftTemplate,
  assignWorkDate,
  buildWorkDay,
  calendarDay,
  inWindow,
} from './domain/work-day';

interface Assignment {
  effectiveFrom: string;
  effectiveTo: string | null;
  /** weekday (1-7) → shift template */
  shifts: Map<number, ShiftTemplate>;
}

/**
 * In-memory snapshot of schedules and holidays for a set of employees and a date range.
 * Loaded with a fixed number of queries, then answers "what did this employee have to work
 * on day X?" without touching the database — recomputing a month for hundreds of employees
 * stays cheap.
 */
export class WorkCalendar {
  /** A day is looked up several times per punch, and this is a snapshot: it does not change. */
  private readonly days = new Map<string, WorkDayContext>();

  constructor(
    private readonly assignments: Map<string, Assignment[]>,
    private readonly holidays: Set<string>,
    readonly timezone: string,
    readonly policy: AttendancePolicy,
  ) {}

  dayFor(employeeId: string, workDate: string): WorkDayContext {
    const key = `${employeeId}|${workDate}`;
    let day = this.days.get(key);
    if (!day) {
      day = this.evaluateDay(employeeId, workDate);
      this.days.set(key, day);
    }
    return day;
  }

  private evaluateDay(employeeId: string, workDate: string): WorkDayContext {
    const assignment = (this.assignments.get(employeeId) ?? []).find(
      (a) => a.effectiveFrom <= workDate && (a.effectiveTo === null || a.effectiveTo >= workDate),
    );
    const weekday = isoWeekday(workDate);
    return buildWorkDay({
      workDate,
      timezone: this.timezone,
      policy: this.policy,
      template: assignment?.shifts.get(weekday) ?? null,
      isHoliday: this.holidays.has(workDate),
      hasSchedule: assignment !== undefined,
    });
  }

  /** Work date a punch belongs to (handles shifts crossing midnight and overlapping windows). */
  workDateOf(employeeId: string, at: Date): string {
    const local = localDateOf(at, this.timezone);
    return assignWorkDate(
      at,
      this.dayFor(employeeId, addDays(local, -1)),
      this.dayFor(employeeId, local),
      this.dayFor(employeeId, addDays(local, 1)),
    );
  }

  /** What to load for a work day: its window and its whole calendar day, where strays are. */
  reachOf(day: WorkDayContext): { from: Date; to: Date } {
    const calendar = calendarDay(day.workDate, this.timezone);
    return {
      from: new Date(Math.min(day.window.from.getTime(), calendar.from.getTime())),
      to: new Date(Math.max(day.window.to.getTime(), calendar.to.getTime())),
    };
  }

  /**
   * Splits punches loaded with `reachOf` into the ones the day counts (its window) and the
   * strays of its calendar day, which it only reports. The rest belong to another day: every
   * punch has one work date, so it never counts twice.
   */
  split<T extends { occurredAt: Date }>(
    employeeId: string,
    day: WorkDayContext,
    punches: T[],
  ): { counted: T[]; strays: T[] } {
    const counted: T[] = [];
    const strays: T[] = [];
    for (const p of punches) {
      if (this.workDateOf(employeeId, p.occurredAt) !== day.workDate) continue;
      (inWindow(p.occurredAt, day) ? counted : strays).push(p);
    }
    return { counted, strays };
  }
}

@Injectable()
export class WorkCalendarService {
  constructor(private readonly prisma: PrismaService) {}

  async load(params: {
    employeeIds: string[];
    from: string;
    to: string;
    timezone: string;
    policy: AttendancePolicy;
  }): Promise<WorkCalendar> {
    // Two days of margin on each side: a window can spill into the next or previous day, and
    // deciding which work date owns a punch there looks at the days around that punch.
    const from = toDbDate(addDays(params.from, -2));
    const to = toDbDate(addDays(params.to, 2));

    const [rows, holidays] = await Promise.all([
      this.prisma.employeeSchedule.findMany({
        where: {
          employeeId: { in: params.employeeIds },
          effectiveFrom: { lte: to },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
        },
        include: { schedule: { include: { days: { include: { shift: true } } } } },
      }),
      this.prisma.holiday.findMany({
        where: { date: { gte: from, lte: to } },
        select: { date: true },
      }),
    ]);

    const assignments = new Map<string, Assignment[]>();
    for (const row of rows) {
      const list = assignments.get(row.employeeId) ?? [];
      list.push({
        effectiveFrom: fromDbDate(row.effectiveFrom),
        effectiveTo: row.effectiveTo ? fromDbDate(row.effectiveTo) : null,
        shifts: new Map(
          row.schedule.days
            .filter((d) => d.shift.deletedAt === null)
            .map((d) => [d.weekday, d.shift satisfies ShiftTemplate]),
        ),
      });
      assignments.set(row.employeeId, list);
    }

    return new WorkCalendar(
      assignments,
      new Set(holidays.map((h) => fromDbDate(h.date))),
      params.timezone,
      params.policy,
    );
  }
}

function isoWeekday(isoDate: string): number {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}
