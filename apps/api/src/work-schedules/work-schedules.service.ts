import { COMPANY_SCHEDULE_NAME } from '@asistcontrol/shared';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { EmployeeSchedule } from '@prisma/client';
import { AttendanceProcessingService } from '../attendance/attendance-processing.service';
import { crossesMidnight } from '../attendance/domain/work-day';
import { AuditService, diff } from '../audit/audit.service';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { apiError } from '../common/errors/api-error';
import { addDays, fromDbDate, toDbDate, todayIn } from '../common/utils/date-only';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import type {
  AssignScheduleDto,
  CreateHolidayDto,
  CreateScheduleDto,
  CreateShiftDto,
  SetupWorkdayDto,
  UpdateScheduleDto,
  UpdateShiftDto,
} from './work-schedules.dto';

/** Retroactive schedule changes recompute at most this many past days. */
const MAX_RETROACTIVE_DAYS = 62;

const COMPANY_SHIFT_NAME = 'Jornada sin hora fija';
/** A few minutes short of the day is not worth a warning, on every day of every person. */
const SHORT_DAY_TOLERANCE_MINUTES = 10;

@Injectable()
export class WorkSchedulesService {
  private readonly logger = new Logger(WorkSchedulesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly processing: AttendanceProcessingService,
  ) {}

  // ─────────────────────────────────────────── shifts

  listShifts() {
    return this.prisma.workShift.findMany({
      where: { deletedAt: null },
      orderBy: { startTime: 'asc' },
    });
  }

  async createShift(dto: CreateShiftDto, actor: AuthenticatedUser, ctx: RequestContext) {
    validateShift(dto);
    return this.prisma.$transaction(async (tx) => {
      const shift = await tx.workShift.create({ data: dto });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'create',
          entity: 'WorkShift',
          entityId: shift.id,
          context: ctx,
          metadata: { ...dto },
        },
        tx,
      );
      return shift;
    });
  }

  async updateShift(
    id: string,
    dto: UpdateShiftDto,
    actor: AuthenticatedUser,
    ctx: RequestContext,
  ) {
    const before = await this.prisma.workShift.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException(apiError('SHIFT_NOT_FOUND', 'Shift not found'));
    validateShift({ ...before, ...dto });
    return this.prisma.$transaction(async (tx) => {
      const shift = await tx.workShift.update({ where: { id }, data: dto });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'update',
          entity: 'WorkShift',
          entityId: id,
          context: ctx,
          metadata: diff(before, { ...dto }),
        },
        tx,
      );
      return shift;
    });
  }

  // ─────────────────────────────────────────── weekly schedules

  listSchedules() {
    return this.prisma.workSchedule.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      include: { days: { include: { shift: true }, orderBy: { weekday: 'asc' } } },
    });
  }

  async getSchedule(id: string) {
    const schedule = await this.prisma.workSchedule.findFirst({
      where: { id, deletedAt: null },
      include: { days: { include: { shift: true }, orderBy: { weekday: 'asc' } } },
    });
    if (!schedule)
      throw new NotFoundException(apiError('SCHEDULE_NOT_FOUND', 'Schedule not found'));
    return schedule;
  }

  async createSchedule(dto: CreateScheduleDto, actor: AuthenticatedUser, ctx: RequestContext) {
    await this.assertShiftsExist(dto.days.map((d) => d.shiftId));
    return this.prisma.$transaction(async (tx) => {
      const schedule = await tx.workSchedule.create({
        data: { name: dto.name, description: dto.description, days: { create: dto.days } },
        include: { days: true },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'create',
          entity: 'WorkSchedule',
          entityId: schedule.id,
          context: ctx,
          metadata: { ...dto },
        },
        tx,
      );
      return schedule;
    });
  }

  async updateSchedule(
    id: string,
    dto: UpdateScheduleDto,
    actor: AuthenticatedUser,
    ctx: RequestContext,
  ) {
    const before = await this.getSchedule(id);
    if (dto.days) await this.assertShiftsExist(dto.days.map((d) => d.shiftId));
    return this.prisma.$transaction(async (tx) => {
      if (dto.days) {
        await tx.workScheduleDay.deleteMany({ where: { scheduleId: id } });
        await tx.workScheduleDay.createMany({
          data: dto.days.map((d) => ({ ...d, scheduleId: id })),
        });
      }
      const schedule = await tx.workSchedule.update({
        where: { id },
        data: { name: dto.name, description: dto.description },
        include: { days: true },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'update',
          entity: 'WorkSchedule',
          entityId: id,
          context: ctx,
          metadata: {
            before: {
              name: before.name,
              days: before.days.map((d) => ({ weekday: d.weekday, shiftId: d.shiftId })),
            },
            after: dto,
          },
        },
        tx,
      );
      return schedule;
    });
  }

  // ─────────────────────────────────────────── assignments

  /** An employee's schedule history, newest first, with calendar dates (`YYYY-MM-DD`). */
  async listAssignments(employeeId: string) {
    await this.assertEmployeeExists(employeeId);
    const rows = await this.prisma.employeeSchedule.findMany({
      where: { employeeId },
      orderBy: { effectiveFrom: 'desc' },
      include: { schedule: { select: { id: true, name: true } } },
    });
    return rows.map((row) => toAssignmentResponse(row));
  }

  /**
   * Assigns a schedule from a date onwards, closing the previous assignment the day before.
   * History is preserved: past days keep being evaluated with the schedule in force back then.
   */
  /**
   * What a company without fixed hours needs, in one step: its workday, the days it works and
   * everyone on it. Running it again changes those values for everyone. An employee who already
   * has a schedule starting on or after that date keeps it: someone chose it on purpose.
   */
  async setupWorkday(dto: SetupWorkdayDto, actor: AuthenticatedUser, ctx: RequestContext) {
    const today = todayIn(await this.settings.getTimezone());
    if (dto.effectiveFrom < addDays(today, -MAX_RETROACTIVE_DAYS)) {
      throw new BadRequestException(
        apiError('ASSIGNMENT_TOO_OLD', `Limited to the last ${MAX_RETROACTIVE_DAYS} days`, {
          maxDays: MAX_RETROACTIVE_DAYS,
        }),
      );
    }

    const hours = referenceDay(dto.dailyMinutes, dto.lunchMinutes);
    const { schedule, employees } = await this.prisma.$transaction(async (tx) => {
      const shift = await tx.workShift.upsert({
        where: { name: COMPANY_SHIFT_NAME },
        create: { name: COMPANY_SHIFT_NAME, ...hours },
        update: { ...hours, deletedAt: null },
      });
      const saved = await tx.workSchedule.upsert({
        where: { name: COMPANY_SCHEDULE_NAME },
        create: { name: COMPANY_SCHEDULE_NAME },
        update: { deletedAt: null },
      });
      await tx.workScheduleDay.deleteMany({ where: { scheduleId: saved.id } });
      await tx.workScheduleDay.createMany({
        data: dto.weekdays.map((weekday) => ({ weekday, scheduleId: saved.id, shiftId: shift.id })),
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'schedule.setup',
          entity: 'WorkSchedule',
          entityId: saved.id,
          context: ctx,
          metadata: { ...dto },
        },
        tx,
      );
      const active = await tx.employee.findMany({
        where: { deletedAt: null, status: 'ACTIVE' },
        select: {
          id: true,
          scheduleAssignments: { orderBy: { effectiveFrom: 'desc' }, take: 1 },
        },
      });
      return { schedule: saved, employees: active };
    });
    await this.settings.updateAttendancePolicy(
      { overtimeEnabled: dto.overtimeEnabled },
      actor,
      ctx,
    );

    const from = toDbDate(dto.effectiveFrom);
    let assigned = 0;
    let kept = 0;
    const onSchedule: string[] = [];
    for (const employee of employees) {
      const latest = employee.scheduleAssignments[0];
      if (latest?.scheduleId === schedule.id) {
        onSchedule.push(employee.id);
      } else if (latest && latest.effectiveFrom >= from) {
        kept++;
      } else {
        await this.createAssignment(
          { employeeId: employee.id, scheduleId: schedule.id, effectiveFrom: dto.effectiveFrom },
          actor,
          ctx,
        );
        onSchedule.push(employee.id);
        assigned++;
      }
    }
    if (onSchedule.length > 0) {
      await this.processing.recomputeRange({
        from: dto.effectiveFrom,
        to: today,
        employeeIds: onSchedule,
      });
    }
    return { scheduleId: schedule.id, assigned, onSchedule: onSchedule.length, kept };
  }

  async assign(dto: AssignScheduleDto, actor: AuthenticatedUser, ctx: RequestContext) {
    await this.assertEmployeeExists(dto.employeeId);
    await this.getSchedule(dto.scheduleId);

    const from = toDbDate(dto.effectiveFrom);
    const later = await this.prisma.employeeSchedule.count({
      where: { employeeId: dto.employeeId, effectiveFrom: { gte: from } },
    });
    if (later > 0) {
      throw new BadRequestException(
        apiError('ASSIGNMENT_DATE_CONFLICT', 'An assignment already starts on or after that date'),
      );
    }

    const assignment = await this.createAssignment(dto, actor, ctx);
    await this.recomputeRetroactively(dto.employeeId, dto.effectiveFrom);
    return toAssignmentResponse(assignment);
  }

  /** Closes the assignment in force the day before and opens the new one, audited. */
  private createAssignment(dto: AssignScheduleDto, actor: AuthenticatedUser, ctx: RequestContext) {
    const from = toDbDate(dto.effectiveFrom);
    return this.prisma.$transaction(async (tx) => {
      await tx.employeeSchedule.updateMany({
        where: {
          employeeId: dto.employeeId,
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
        },
        data: { effectiveTo: toDbDate(addDays(dto.effectiveFrom, -1)) },
      });
      const created = await tx.employeeSchedule.create({
        data: { employeeId: dto.employeeId, scheduleId: dto.scheduleId, effectiveFrom: from },
        include: { schedule: { select: { id: true, name: true } } },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'schedule.assigned',
          entity: 'Employee',
          entityId: dto.employeeId,
          context: ctx,
          metadata: { ...dto },
        },
        tx,
      );
      return created;
    });
  }

  /**
   * Undoes an employee's latest assignment (e.g. the wrong schedule was picked): it is removed
   * and the previous one runs open-ended again. Older assignments are history and stay; so do
   * assignments that started before the recompute window, whose days could not be re-evaluated.
   */
  async unassign(id: string, actor: AuthenticatedUser, ctx: RequestContext) {
    const assignment = await this.prisma.employeeSchedule.findUnique({ where: { id } });
    if (!assignment)
      throw new NotFoundException(apiError('ASSIGNMENT_NOT_FOUND', 'Assignment not found'));
    const { employeeId, effectiveFrom } = assignment;

    const later = await this.prisma.employeeSchedule.count({
      where: { employeeId, effectiveFrom: { gt: effectiveFrom } },
    });
    if (later > 0)
      throw new BadRequestException(
        apiError('ASSIGNMENT_NOT_LATEST', 'Only the latest assignment can be undone'),
      );

    const from = fromDbDate(effectiveFrom);
    const today = todayIn(await this.settings.getTimezone());
    if (from < addDays(today, -MAX_RETROACTIVE_DAYS)) {
      throw new BadRequestException(
        apiError(
          'ASSIGNMENT_TOO_OLD',
          `Assignments that started more than ${MAX_RETROACTIVE_DAYS} days ago cannot be undone`,
          { maxDays: MAX_RETROACTIVE_DAYS },
        ),
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.employeeSchedule.delete({ where: { id } });
      const previous = await tx.employeeSchedule.findFirst({
        where: { employeeId, effectiveFrom: { lt: effectiveFrom } },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (previous) {
        await tx.employeeSchedule.update({
          where: { id: previous.id },
          data: { effectiveTo: null },
        });
      }
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'schedule.unassigned',
          entity: 'Employee',
          entityId: employeeId,
          context: ctx,
          metadata: {
            scheduleId: assignment.scheduleId,
            effectiveFrom: from,
            restoredScheduleId: previous?.scheduleId ?? null,
          },
        },
        tx,
      );
    });

    await this.recomputeRetroactively(employeeId, from);
  }

  // ─────────────────────────────────────────── holidays

  async listHolidays(year?: number) {
    const where = year
      ? { date: { gte: toDbDate(`${year}-01-01`), lte: toDbDate(`${year}-12-31`) } }
      : undefined;
    const holidays = await this.prisma.holiday.findMany({ where, orderBy: { date: 'asc' } });
    return holidays.map((h) => ({ ...h, date: fromDbDate(h.date) }));
  }

  async createHoliday(dto: CreateHolidayDto, actor: AuthenticatedUser, ctx: RequestContext) {
    const holiday = await this.prisma.$transaction(async (tx) => {
      const created = await tx.holiday.create({
        data: { date: toDbDate(dto.date), name: dto.name },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'create',
          entity: 'Holiday',
          entityId: created.id,
          context: ctx,
          metadata: { ...dto },
        },
        tx,
      );
      return created;
    });
    await this.recomputeDateIfPast(dto.date);
    return { ...holiday, date: dto.date };
  }

  async removeHoliday(id: string, actor: AuthenticatedUser, ctx: RequestContext) {
    const holiday = await this.prisma.holiday.findUnique({ where: { id } });
    if (!holiday) throw new NotFoundException(apiError('HOLIDAY_NOT_FOUND', 'Holiday not found'));
    await this.prisma.$transaction(async (tx) => {
      await tx.holiday.delete({ where: { id } });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'delete',
          entity: 'Holiday',
          entityId: id,
          context: ctx,
          metadata: { date: fromDbDate(holiday.date), name: holiday.name },
        },
        tx,
      );
    });
    await this.recomputeDateIfPast(fromDbDate(holiday.date));
  }

  // ─────────────────────────────────────────── helpers

  private async assertEmployeeExists(id: string) {
    const found = await this.prisma.employee.count({ where: { id, deletedAt: null } });
    if (found === 0)
      throw new NotFoundException(apiError('EMPLOYEE_NOT_FOUND', 'Employee not found'));
  }

  private async assertShiftsExist(ids: string[]) {
    const unique = [...new Set(ids)];
    const found = await this.prisma.workShift.count({
      where: { id: { in: unique }, deletedAt: null },
    });
    if (found !== unique.length)
      throw new BadRequestException(
        apiError('SHIFTS_NOT_FOUND', 'One or more shifts do not exist'),
      );
  }

  private async recomputeRetroactively(employeeId: string, from: string) {
    const today = todayIn(await this.settings.getTimezone());
    if (from > today) return;
    const earliest = addDays(today, -MAX_RETROACTIVE_DAYS);
    const start = from < earliest ? earliest : from;
    await this.processing.recomputeRange({ from: start, to: today, employeeIds: [employeeId] });
  }

  private async recomputeDateIfPast(date: string) {
    const today = todayIn(await this.settings.getTimezone());
    if (date > today) return;
    this.processing
      .recomputeRange({ from: date, to: date })
      .catch((err: unknown) => this.logger.error({ err, date }, 'Holiday recompute failed'));
  }
}

type AssignmentRow = EmployeeSchedule & { schedule: { id: string; name: string } };

/** `@db.Date` columns go out as calendar dates, like every other date-only field. */
function toAssignmentResponse({ effectiveFrom, effectiveTo, ...rest }: AssignmentRow) {
  return {
    ...rest,
    effectiveFrom: fromDbDate(effectiveFrom),
    effectiveTo: effectiveTo ? fromDbDate(effectiveTo) : null,
  };
}

/**
 * A day without fixed hours as the shift stores it: a reference from 08:00, with the lunch at
 * 13:00, ending when the expected hours are done. Only its length and its lunch matter.
 */
function referenceDay(dailyMinutes: number, lunchMinutes: number) {
  const clock = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const start = 8 * 60;
  const lunch = 13 * 60;
  return {
    startTime: clock(start),
    endTime: clock(start + dailyMinutes + lunchMinutes),
    breakStart: lunchMinutes > 0 ? clock(lunch) : null,
    breakEnd: lunchMinutes > 0 ? clock(lunch + lunchMinutes) : null,
    flexible: true,
    earlyLeaveToleranceMinutes: SHORT_DAY_TOLERANCE_MINUTES,
  };
}

function validateShift(shift: {
  startTime: string;
  endTime: string;
  breakStart?: string | null;
  breakEnd?: string | null;
  flexible?: boolean;
}) {
  if (Boolean(shift.breakStart) !== Boolean(shift.breakEnd)) {
    throw new BadRequestException(
      apiError('BREAK_INCOMPLETE', 'breakStart and breakEnd must be provided together'),
    );
  }
  // Its days are calendar days: a reference day crossing midnight could not be measured.
  if (shift.flexible && crossesMidnight(shift.startTime, shift.endTime)) {
    throw new BadRequestException(
      apiError('FLEXIBLE_SHIFT_OVERNIGHT', 'A shift without fixed hours cannot cross midnight'),
    );
  }
}
