import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { addDays, eachDate, fromDbDate, localDateOf, toDbDate } from '../common/utils/date-only';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SettingsService } from '../settings/settings.service';
import { calculateAttendance } from './domain/attendance-calculator';
import type { CalculationResult } from './domain/types';
import { type WorkCalendar, WorkCalendarService } from './work-calendar.service';

interface EmployeeRef {
  id: string;
  supervisorId: string | null;
  hireDate: Date;
  terminatedAt: Date | null;
}

const EMPLOYEE_REF = { id: true, supervisorId: true, hireDate: true, terminatedAt: true } as const;
const FINALIZER_LOOKBACK_DAYS = 7;

/**
 * Application service that turns AttendanceEvents into AttendanceRecords.
 * It gathers the inputs (calendar, punches, approved leave, policy), delegates every rule to
 * the pure `calculateAttendance`, and persists the outcome. Recomputing is idempotent, so
 * any change (new punch, void, schedule change, holiday, approved leave) simply recomputes.
 */
@Injectable()
export class AttendanceProcessingService {
  private readonly logger = new Logger(AttendanceProcessingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly calendars: WorkCalendarService,
    private readonly settings: SettingsService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Recomputes every work day touched by the given punches. */
  async processEvents(events: { employeeId: string | null; occurredAt: Date }[]): Promise<number> {
    const linked = events.filter(
      (e): e is { employeeId: string; occurredAt: Date } => e.employeeId !== null,
    );
    if (linked.length === 0) return 0;

    const timezone = await this.settings.getTimezone();
    const dates = linked
      .map((e) => localDateOf(e.occurredAt, timezone))
      .sort((a, b) => a.localeCompare(b));
    const employeeIds = [...new Set(linked.map((e) => e.employeeId))];
    const calendar = await this.loadCalendar(employeeIds, addDays(dates[0]!, -1), dates.at(-1)!);
    const employees = await this.employeesById(employeeIds);

    const pairs = new Map<string, { employee: EmployeeRef; workDate: string }>();
    for (const e of linked) {
      const employee = employees.get(e.employeeId);
      if (!employee) continue;
      const workDate = calendar.workDateOf(e.employeeId, e.occurredAt);
      pairs.set(`${e.employeeId}|${workDate}`, { employee, workDate });
    }
    for (const { employee, workDate } of pairs.values()) {
      await this.recomputeWith(calendar, employee, workDate);
    }
    return pairs.size;
  }

  async recomputeRange(params: {
    from: string;
    to: string;
    employeeIds?: string[];
  }): Promise<{ recomputed: number }> {
    const employees = await this.prisma.employee.findMany({
      where: {
        deletedAt: null,
        id: params.employeeIds ? { in: params.employeeIds } : undefined,
        hireDate: { lte: toDbDate(params.to) },
      },
      select: EMPLOYEE_REF,
    });
    if (employees.length === 0) return { recomputed: 0 };

    const calendar = await this.loadCalendar(
      employees.map((e) => e.id),
      params.from,
      params.to,
    );
    let recomputed = 0;
    for (const employee of employees) {
      for (const date of eachDate(params.from, params.to)) {
        if (!isEmployed(employee, date)) continue;
        await this.recomputeWith(calendar, employee, date);
        recomputed++;
      }
    }
    return { recomputed };
  }

  async recompute(employeeId: string, workDate: string) {
    const employees = await this.employeesById([employeeId]);
    const employee = employees.get(employeeId);
    if (!employee || !isEmployed(employee, workDate)) return null;
    const calendar = await this.loadCalendar([employeeId], workDate, workDate);
    return this.recomputeWith(calendar, employee, workDate);
  }

  /**
   * Closes open work days: finalizes provisional records whose window has ended and creates
   * the ABSENT records for employees that never punched. Safe to run repeatedly.
   */
  async finalizePendingDays(now = new Date()): Promise<{ finalized: number; created: number }> {
    const timezone = await this.settings.getTimezone();
    const today = localDateOf(now, timezone);

    const provisional = await this.prisma.attendanceRecord.findMany({
      where: {
        isFinal: false,
        workDate: { gte: toDbDate(addDays(today, -FINALIZER_LOOKBACK_DAYS)), lte: toDbDate(today) },
      },
      select: { employeeId: true, workDate: true },
    });
    for (const r of provisional) await this.recompute(r.employeeId, fromDbDate(r.workDate));

    // A week of look-back tolerates the API being down for several days.
    let created = 0;
    for (const date of eachDate(addDays(today, -FINALIZER_LOOKBACK_DAYS), addDays(today, -1))) {
      const missing = await this.prisma.employee.findMany({
        where: {
          deletedAt: null,
          status: 'ACTIVE',
          hireDate: { lte: toDbDate(date) },
          attendanceRecords: { none: { workDate: toDbDate(date) } },
        },
        select: { id: true },
      });
      if (missing.length === 0) continue;
      const result = await this.recomputeRange({
        from: date,
        to: date,
        employeeIds: missing.map((e) => e.id),
      });
      created += result.recomputed;
    }
    return { finalized: provisional.length, created };
  }

  // ───────────────────────────────────────────────────────── internals

  private async recomputeWith(calendar: WorkCalendar, employee: EmployeeRef, workDate: string) {
    const day = calendar.dayFor(employee.id, workDate);
    const [events, leaves] = await Promise.all([
      this.prisma.attendanceEvent.findMany({
        where: {
          employeeId: employee.id,
          voidedAt: null,
          occurredAt: { gte: day.window.from, lt: day.window.to },
        },
        select: { id: true, occurredAt: true, punchType: true },
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          employeeId: employee.id,
          status: 'APPROVED',
          startsAt: { lt: day.window.to },
          endsAt: { gt: day.window.from },
        },
        select: { id: true, startsAt: true, endsAt: true },
      }),
    ]);

    const result = calculateAttendance({
      day,
      punches: events.map((e) => ({ id: e.id, at: e.occurredAt, type: e.punchType })),
      leaves: leaves.map((l) => ({ id: l.id, start: l.startsAt, end: l.endsAt })),
      policy: calendar.policy,
      now: new Date(),
    });

    const dbDate = toDbDate(workDate);
    if (events.length === 0 && !result.isFinal) {
      // Nothing to say yet (e.g. the day has not started). Drop a stale provisional row.
      await this.prisma.attendanceRecord.deleteMany({
        where: { employeeId: employee.id, workDate: dbDate, isFinal: false },
      });
      return null;
    }

    const data = toRecordData(result, day.shift);
    const record = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.attendanceRecord.upsert({
        where: { employeeId_workDate: { employeeId: employee.id, workDate: dbDate } },
        create: { employeeId: employee.id, workDate: dbDate, dayType: day.dayType, ...data },
        update: { dayType: day.dayType, ...data },
      });
      await this.syncOvertime(tx, employee.id, dbDate, result);
      return saved;
    });

    this.realtime.attendanceRecordUpdated(
      {
        employeeId: employee.id,
        workDate,
        status: record.status,
        lateMinutes: record.lateMinutes,
        workedMinutes: record.workedMinutes,
      },
      { employeeId: employee.id, supervisorId: employee.supervisorId },
    );
    return record;
  }

  /**
   * Overtime is proposed automatically but decided by a person. A reviewed record is never
   * overwritten by a recomputation; only PENDING proposals follow the calculation.
   */
  private async syncOvertime(
    tx: Prisma.TransactionClient,
    employeeId: string,
    workDate: Date,
    result: CalculationResult,
  ) {
    const key = { employeeId_workDate: { employeeId, workDate } };
    const existing = await tx.overtimeRecord.findUnique({ where: key });
    if (result.overtimeMinutes > 0 && result.overtimeKind) {
      if (!existing) {
        await tx.overtimeRecord.create({
          data: {
            employeeId,
            workDate,
            minutes: result.overtimeMinutes,
            kind: result.overtimeKind,
          },
        });
      } else if (existing.status === 'PENDING') {
        await tx.overtimeRecord.update({
          where: key,
          data: { minutes: result.overtimeMinutes, kind: result.overtimeKind },
        });
      } else if (existing.minutes !== result.overtimeMinutes) {
        this.logger.warn(
          { employeeId, workDate, reviewed: existing.minutes, now: result.overtimeMinutes },
          'Reviewed overtime differs from recalculation',
        );
      }
    } else if (existing?.status === 'PENDING') {
      await tx.overtimeRecord.delete({ where: key });
    }
  }

  private async loadCalendar(employeeIds: string[], from: string, to: string) {
    const [timezone, policy] = await Promise.all([
      this.settings.getTimezone(),
      this.settings.getAttendancePolicy(),
    ]);
    return this.calendars.load({ employeeIds, from, to, timezone, policy });
  }

  private async employeesById(ids: string[]): Promise<Map<string, EmployeeRef>> {
    const rows = await this.prisma.employee.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: EMPLOYEE_REF,
    });
    return new Map(rows.map((r) => [r.id, r]));
  }
}

function isEmployed(employee: EmployeeRef, date: string): boolean {
  if (date < fromDbDate(employee.hireDate)) return false;
  return !employee.terminatedAt || date <= fromDbDate(employee.terminatedAt);
}

function toRecordData(
  result: CalculationResult,
  shift: { shiftId: string; start: Date; end: Date } | null,
) {
  return {
    status: result.status,
    shiftId: shift?.shiftId ?? null,
    scheduledStart: shift?.start ?? null,
    scheduledEnd: shift?.end ?? null,
    firstIn: result.firstIn,
    lastOut: result.lastOut,
    workedMinutes: result.workedMinutes,
    breakMinutes: result.breakMinutes,
    lateMinutes: result.lateMinutes,
    earlyLeaveMinutes: result.earlyLeaveMinutes,
    overtimeMinutes: result.overtimeMinutes,
    anomalies: result.anomalies,
    segments: result.segments.map((s) => ({
      in: s.in?.toISOString() ?? null,
      out: s.out?.toISOString() ?? null,
    })) as Prisma.InputJsonValue,
    isFinal: result.isFinal,
    calculatedAt: new Date(),
  };
}
