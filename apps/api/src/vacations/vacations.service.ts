import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { WorkCalendarService } from '../attendance/work-calendar.service';
import { AuditService } from '../audit/audit.service';
import { AccessScopeService } from '../common/access/access-scope.service';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { fromDbDate, localDateOf, localDayBounds, todayIn } from '../common/utils/date-only';
import { toContractTypeResponse, vacationRuleOf } from '../contract-types/contract-types.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import {
  type VacationCredit,
  type VacationDayCounting,
  accruedVacationDays,
  coveredShare,
  datesCovered,
  round,
  vacationCredits,
  vacationDayCost,
} from './domain/vacation-entitlement';
import { type VacationDebit, simulateExpiry } from './domain/vacation-expiry';
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
 *   available = accrued + adjustments − used − scheduled − pending − expired
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
      {
        counting: balance.contractType.vacationDayCounting,
        halfDays: balance.contractType.allowHalfDayVacations,
      },
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
        expiredDays: 0,
        nextExpiry: null,
        availableDays: adjustmentDays,
        adjustments: adjustments.map(toAdjustment),
      };
    }

    const contractType = toContractTypeResponse(employee.contractType);
    const rule = vacationRuleOf(employee.contractType);
    const hireDate = fromDbDate(employee.hireDate);
    const terminatedOn = employee.terminatedAt ? fromDbDate(employee.terminatedAt) : null;
    const accrual = accruedVacationDays(rule, hireDate, asOf, terminatedOn);
    const counted = await this.daysOf(
      employeeId,
      leaves as LeaveSpan[],
      {
        counting: contractType.vacationDayCounting,
        halfDays: contractType.allowHalfDayVacations,
      },
      timezone,
      asOf,
    );

    // Adjustments never expire: an opening balance that should can be corrected with another.
    const expiry =
      rule.expiryMonths === null
        ? { expiredDays: 0, nextExpiry: null }
        : simulateExpiry(
            [
              ...vacationCredits(rule, hireDate, asOf, terminatedOn),
              ...adjustments
                .filter((a) => Number(a.days) > 0)
                .map((a): VacationCredit => ({
                  date: localDateOf(a.createdAt, timezone),
                  days: Number(a.days),
                  expiresOn: null,
                })),
            ],
            [
              ...counted.approvedByDate,
              ...adjustments
                .filter((a) => Number(a.days) < 0)
                .map((a): VacationDebit => ({
                  date: localDateOf(a.createdAt, timezone),
                  days: -Number(a.days),
                })),
            ],
            asOf,
            terminatedOn,
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
      expiredDays: expiry.expiredDays,
      nextExpiry: expiry.nextExpiry,
      availableDays: round(
        accrual.accruedDays +
          adjustmentDays -
          counted.used -
          counted.scheduled -
          counted.pending -
          expiry.expiredDays,
      ),
      adjustments: adjustments.map(toAdjustment),
    };
  }

  /**
   * Days the given leaves take from the balance, split by state: approved days up to `asOf`
   * were used, later ones are scheduled, and pending requests hold their days in reserve.
   * `approvedByDate` lists every approved day that counts, for the expiry timeline.
   */
  private async daysOf(
    employeeId: string,
    leaves: LeaveSpan[],
    rules: { counting: VacationDayCounting; halfDays: boolean },
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
      (rules.counting === 'WORKING_DAYS' || rules.halfDays) && all.length > 0
        ? await this.calendars.load({
            employeeIds: [employeeId],
            from: all[0]!,
            to: all.at(-1)!,
            timezone,
            policy: await this.settings.getAttendancePolicy(),
          })
        : null;

    /** Half days only price a vacation within one date; longer ones take whole days. */
    const cost = (leave: LeaveSpan, date: string, singleDay: boolean) => {
      const day = calendar?.dayFor(employeeId, date);
      const isWorkingDay = day ? day.dayType === 'WORKDAY' : true;
      if (!rules.halfDays || !singleDay || !day) {
        return vacationDayCost(rules.counting, isWorkingDay, null);
      }
      const bounds = localDayBounds(date, timezone);
      const { shift } = day;
      const share = coveredShare(
        { start: leave.startsAt, end: leave.endsAt },
        { start: bounds.from, end: bounds.to },
        shift && {
          start: shift.start,
          end: shift.end,
          break:
            shift.breakStart && shift.breakEnd
              ? { start: shift.breakStart, end: shift.breakEnd }
              : null,
        },
      );
      return vacationDayCost(rules.counting, isWorkingDay, share);
    };

    let used = 0;
    let scheduled = 0;
    let pending = 0;
    const approvedByDate: VacationDebit[] = [];
    for (const { leave, dates } of spans) {
      for (const date of dates) {
        const days = cost(leave, date, dates.length === 1);
        if (days === 0) continue;
        if (leave.status === 'PENDING') pending += days;
        else if (date <= asOf) used += days;
        else scheduled += days;
        if (leave.status === 'APPROVED') approvedByDate.push({ date, days });
      }
    }
    return { used, scheduled, pending, total: used + scheduled + pending, approvedByDate };
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
