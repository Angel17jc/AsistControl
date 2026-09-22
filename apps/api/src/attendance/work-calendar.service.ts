import { Injectable } from '@nestjs/common';
import { addDays, fromDbDate, localDateOf, toDbDate } from '../common/utils/date-only';
import { PrismaService } from '../prisma/prisma.service';
import type { AttendancePolicy } from './domain/attendance-policy';
import type { WorkDayContext } from './domain/types';
import { type ShiftTemplate, assignWorkDate, buildWorkDay } from './domain/work-day';

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
  constructor(
    private readonly assignments: Map<string, Assignment[]>,
    private readonly holidays: Set<string>,
    readonly timezone: string,
    readonly policy: AttendancePolicy,
  ) {}

  dayFor(employeeId: string, workDate: string): WorkDayContext {
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

  /** Work date a punch belongs to (handles night shifts crossing midnight). */
  workDateOf(employeeId: string, at: Date): string {
    const local = localDateOf(at, this.timezone);
    return assignWorkDate(
      at,
      this.dayFor(employeeId, addDays(local, -1)),
      this.dayFor(employeeId, local),
    );
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
    // One day of margin on each side: night shifts and punch → work date assignment look at neighbours.
    const from = toDbDate(addDays(params.from, -1));
    const to = toDbDate(addDays(params.to, 1));

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
