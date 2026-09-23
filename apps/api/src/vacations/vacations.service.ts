import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { WorkCalendarService } from '../attendance/work-calendar.service';
import { AuditService } from '../audit/audit.service';
import { AccessScopeService } from '../common/access/access-scope.service';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { fromDbDate, localDateOf, todayIn } from '../common/utils/date-only';
import { toContractTypeResponse, vacationRuleOf } from '../contract-types/contract-types.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import {
  accruedVacationDays,
  datesCovered,
  round,
  vacationDaysUsed,
} from './domain/vacation-entitlement';
import type { CreateVacationAdjustmentDto } from './vacations.dto';

interface LeaveSpan {
  id: string;
  status: 'PENDING' | 'APPROVED';
  startsAt: Date;
  endsAt: Date;
}

/**
 * Vacation balances. Nothing is stored but the inputs (contract rules, hire date, approved
 * and pending requests, manual adjustments): the balance is recomputed on every read, so
 * editing a contract type or cancelling a request is reflected at once and never drifts.
 *
 *   available = accrued + adjustments − used − scheduled − pending
 */
@Injectable()
export class VacationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: AccessScopeService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly calendars: WorkCalendarService,
  ) {}

  async balance(employeeId: string, user: AuthenticatedUser, asOf?: string) {
    await this.scope.assertCanAccessEmployee(user, employeeId);
    const timezone = await this.settings.getTimezone();
    return this.compute(employeeId, asOf ?? todayIn(timezone), timezone);
  }

  /**
   * Refuses a vacation the balance cannot cover. Days are counted as of the day the vacation
   * starts, so a person may book a vacation for after their next anniversary. `requestId`
   * leaves the request itself out when it is already stored (on approval).
   */
  async assertAffordable(request: {
    id?: string;
    employeeId: string;
    startsAt: Date;
    endsAt: Date;
  }): Promise<void> {
    const timezone = await this.settings.getTimezone();
    const startDate = localDateOf(request.startsAt, timezone);
    const balance = await this.compute(request.employeeId, startDate, timezone, request.id);
    // No contract type, no entitlement rules: nothing to check against.
    if (!balance.contractType) return;

    const requested = await this.daysOf(
      request.employeeId,
      [{ id: 'new', status: 'PENDING', startsAt: request.startsAt, endsAt: request.endsAt }],
      balance.contractType.vacationDayCounting,
      timezone,
    );
    if (requested.total === 0) {
      throw new ConflictException('The vacation covers no day that counts against the balance');
    }
    if (
      !balance.contractType.allowNegativeVacationBalance &&
      requested.total > balance.availableDays
    ) {
      throw new ConflictException(
        `Insufficient vacation balance: ${balance.availableDays} day(s) available on ` +
          `${startDate}, the request uses ${requested.total}`,
      );
    }
  }

  async addAdjustment(
    employeeId: string,
    dto: CreateVacationAdjustmentDto,
    actor: AuthenticatedUser,
    ctx: RequestContext,
  ) {
    await this.employee(employeeId);
    const adjustment = await this.prisma.$transaction(async (tx) => {
      const row = await tx.vacationAdjustment.create({
        data: { employeeId, days: dto.days, reason: dto.reason, createdById: actor.id },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'vacation.adjusted',
          entity: 'Employee',
          entityId: employeeId,
          context: ctx,
          metadata: { adjustmentId: row.id, days: dto.days, reason: dto.reason },
        },
        tx,
      );
      return row;
    });
    return { ...adjustment, days: Number(adjustment.days) };
  }

  private async compute(
    employeeId: string,
    asOf: string,
    timezone: string,
    excludeRequestId?: string,
  ) {
    const employee = await this.employee(employeeId);
    const [adjustments, leaves] = await Promise.all([
      this.prisma.vacationAdjustment.findMany({
        where: { employeeId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          employeeId,
          type: 'VACATION',
          status: { in: ['PENDING', 'APPROVED'] },
          ...(excludeRequestId && { id: { not: excludeRequestId } }),
        },
        select: { id: true, status: true, startsAt: true, endsAt: true },
      }),
    ]);
    const adjustmentDays = round(adjustments.reduce((sum, a) => sum + Number(a.days), 0));

    if (!employee.contractType) {
      return {
        employeeId,
        asOf,
        contractType: null,
        accrual: null,
        accruedDays: 0,
        adjustmentDays,
        usedDays: 0,
        scheduledDays: 0,
        pendingDays: 0,
        availableDays: adjustmentDays,
        adjustments: adjustments.map(toAdjustment),
      };
    }

    const contractType = toContractTypeResponse(employee.contractType);
    const accrual = accruedVacationDays(
      vacationRuleOf(employee.contractType),
      fromDbDate(employee.hireDate),
      asOf,
      employee.terminatedAt ? fromDbDate(employee.terminatedAt) : null,
    );
    const counted = await this.daysOf(
      employeeId,
      leaves as LeaveSpan[],
      contractType.vacationDayCounting,
      timezone,
      asOf,
    );
    return {
      employeeId,
      asOf,
      contractType,
      accrual: {
        completedServiceYears: accrual.completedServiceYears,
        currentYearEntitlement: accrual.currentYearEntitlement,
        nextCreditOn: accrual.nextCreditOn,
      },
      accruedDays: accrual.accruedDays,
      adjustmentDays,
      usedDays: counted.used,
      scheduledDays: counted.scheduled,
      pendingDays: counted.pending,
      availableDays: round(
        accrual.accruedDays + adjustmentDays - counted.used - counted.scheduled - counted.pending,
      ),
      adjustments: adjustments.map(toAdjustment),
    };
  }

  /**
   * Days the given leaves take from the balance, split by state: approved days up to `asOf`
   * were used, later ones are scheduled, and pending requests hold their days in reserve.
   */
  private async daysOf(
    employeeId: string,
    leaves: LeaveSpan[],
    counting: 'CALENDAR_DAYS' | 'WORKING_DAYS',
    timezone: string,
    asOf = '9999-12-31',
  ) {
    const spans = leaves.map((leave) => ({
      leave,
      // The end is exclusive: a vacation ending at 00:00 does not take that day.
      dates: datesCovered(
        localDateOf(leave.startsAt, timezone),
        localDateOf(new Date(leave.endsAt.getTime() - 1), timezone),
      ),
    }));
    const all = spans.flatMap((s) => s.dates).sort();
    const calendar =
      counting === 'WORKING_DAYS' && all.length > 0
        ? await this.calendars.load({
            employeeIds: [employeeId],
            from: all[0]!,
            to: all.at(-1)!,
            timezone,
            policy: await this.settings.getAttendancePolicy(),
          })
        : null;
    const isWorkingDay = (date: string) =>
      calendar ? calendar.dayFor(employeeId, date).dayType === 'WORKDAY' : true;

    let used = 0;
    let scheduled = 0;
    let pending = 0;
    for (const { leave, dates } of spans) {
      if (leave.status === 'PENDING') {
        pending += vacationDaysUsed(dates, counting, isWorkingDay);
        continue;
      }
      used += vacationDaysUsed(
        dates.filter((d) => d <= asOf),
        counting,
        isWorkingDay,
      );
      scheduled += vacationDaysUsed(
        dates.filter((d) => d > asOf),
        counting,
        isWorkingDay,
      );
    }
    return { used, scheduled, pending, total: used + scheduled + pending };
  }

  private async employee(id: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, deletedAt: null },
      include: { contractType: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }
}

function toAdjustment(row: {
  id: string;
  days: unknown;
  reason: string;
  createdById: string;
  createdAt: Date;
}) {
  return {
    id: row.id,
    days: Number(row.days),
    reason: row.reason,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
  };
}
