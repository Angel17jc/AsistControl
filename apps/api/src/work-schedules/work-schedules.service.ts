import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { EmployeeSchedule } from '@prisma/client';
import { AttendanceProcessingService } from '../attendance/attendance-processing.service';
import { AuditService, diff } from '../audit/audit.service';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { addDays, fromDbDate, toDbDate, todayIn } from '../common/utils/date-only';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import type {
  AssignScheduleDto,
  CreateHolidayDto,
  CreateScheduleDto,
  CreateShiftDto,
  UpdateScheduleDto,
  UpdateShiftDto,
} from './work-schedules.dto';

/** Retroactive schedule changes recompute at most this many past days. */
const MAX_RETROACTIVE_DAYS = 62;

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
    validateBreak(dto);
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
    if (!before) throw new NotFoundException('Shift not found');
    validateBreak({ ...before, ...dto });
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
    if (!schedule) throw new NotFoundException('Schedule not found');
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
  async assign(dto: AssignScheduleDto, actor: AuthenticatedUser, ctx: RequestContext) {
    await this.assertEmployeeExists(dto.employeeId);
    await this.getSchedule(dto.scheduleId);

    const from = toDbDate(dto.effectiveFrom);
    const later = await this.prisma.employeeSchedule.count({
      where: { employeeId: dto.employeeId, effectiveFrom: { gte: from } },
    });
    if (later > 0) {
      throw new BadRequestException('An assignment already starts on or after that date');
    }

    const assignment = await this.prisma.$transaction(async (tx) => {
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

    await this.recomputeRetroactively(dto.employeeId, dto.effectiveFrom);
    return toAssignmentResponse(assignment);
  }

  /**
   * Undoes an employee's latest assignment (e.g. the wrong schedule was picked): it is removed
   * and the previous one runs open-ended again. Older assignments are history and stay; so do
   * assignments that started before the recompute window, whose days could not be re-evaluated.
   */
  async unassign(id: string, actor: AuthenticatedUser, ctx: RequestContext) {
    const assignment = await this.prisma.employeeSchedule.findUnique({ where: { id } });
    if (!assignment) throw new NotFoundException('Assignment not found');
    const { employeeId, effectiveFrom } = assignment;

    const later = await this.prisma.employeeSchedule.count({
      where: { employeeId, effectiveFrom: { gt: effectiveFrom } },
    });
    if (later > 0) throw new BadRequestException('Only the latest assignment can be undone');

    const from = fromDbDate(effectiveFrom);
    const today = todayIn(await this.settings.getTimezone());
    if (from < addDays(today, -MAX_RETROACTIVE_DAYS)) {
      throw new BadRequestException(
        `Assignments that started more than ${MAX_RETROACTIVE_DAYS} days ago cannot be undone`,
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
    if (!holiday) throw new NotFoundException('Holiday not found');
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
    if (found === 0) throw new NotFoundException('Employee not found');
  }

  private async assertShiftsExist(ids: string[]) {
    const unique = [...new Set(ids)];
    const found = await this.prisma.workShift.count({
      where: { id: { in: unique }, deletedAt: null },
    });
    if (found !== unique.length) throw new BadRequestException('One or more shifts do not exist');
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

function validateBreak(shift: { breakStart?: string | null; breakEnd?: string | null }) {
  if (Boolean(shift.breakStart) !== Boolean(shift.breakEnd)) {
    throw new BadRequestException('breakStart and breakEnd must be provided together');
  }
}
