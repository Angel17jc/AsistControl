import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LeaveRequest, Prisma } from '@prisma/client';
import { AttendanceProcessingService } from '../attendance/attendance-processing.service';
import { AuditService } from '../audit/audit.service';
import { AccessScopeService } from '../common/access/access-scope.service';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { paginate, skipTake } from '../common/dto/pagination.dto';
import type { ReviewDto } from '../common/dto/review.dto';
import { apiError } from '../common/errors/api-error';
import { addDays, localDateOf, todayIn } from '../common/utils/date-only';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { VacationsService } from '../vacations/vacations.service';
import type { CreateLeaveRequestDto, LeaveQueryDto } from './leave-requests.dto';

const MAX_LEAVE_DAYS = 90;

/**
 * Permissions (by hours or days) and vacations share one approval workflow.
 * Only APPROVED requests affect attendance: the processing service consults them when
 * computing lateness, early leave and absences.
 */
@Injectable()
export class LeaveRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: AccessScopeService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly processing: AttendanceProcessingService,
    private readonly notifications: NotificationsService,
    private readonly vacations: VacationsService,
  ) {}

  async list(query: LeaveQueryDto, user: AuthenticatedUser) {
    const where: Prisma.LeaveRequestWhereInput = {
      status: query.status,
      type: query.type,
      employeeId: query.employeeId,
      ...this.scope.relationWhere(user),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.leaveRequest.findMany({
        where,
        orderBy: { startsAt: 'desc' },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        },
        ...skipTake(query),
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);
    return paginate(rows, total, query);
  }

  async create(dto: CreateLeaveRequestDto, actor: AuthenticatedUser, ctx: RequestContext) {
    const employeeId = dto.employeeId ?? actor.employeeId;
    if (!employeeId)
      throw new BadRequestException(
        apiError(
          'LEAVE_EMPLOYEE_REQUIRED',
          'employeeId is required for accounts without an employee',
        ),
      );
    await this.scope.assertCanAccessEmployee(actor, employeeId);

    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt)
      throw new BadRequestException(
        apiError('LEAVE_ENDS_BEFORE_START', 'endsAt must be after startsAt'),
      );
    if (endsAt.getTime() - startsAt.getTime() > MAX_LEAVE_DAYS * 86_400_000) {
      throw new BadRequestException(
        apiError('LEAVE_TOO_LONG', `A single request cannot exceed ${MAX_LEAVE_DAYS} days`, {
          maxDays: MAX_LEAVE_DAYS,
        }),
      );
    }

    const overlapping = await this.prisma.leaveRequest.count({
      where: {
        employeeId,
        status: { in: ['PENDING', 'APPROVED'] },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
    });
    if (overlapping > 0)
      throw new ConflictException(
        apiError('LEAVE_OVERLAP', 'The employee already has a request overlapping these dates'),
      );
    if (dto.type === 'VACATION') {
      await this.vacations.assertAffordable({ employeeId, startsAt, endsAt });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const request = await tx.leaveRequest.create({
        data: {
          employeeId,
          type: dto.type,
          startsAt,
          endsAt,
          reason: dto.reason,
          requestedById: actor.id,
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'create',
          entity: 'LeaveRequest',
          entityId: request.id,
          context: ctx,
          metadata: { ...dto, employeeId },
        },
        tx,
      );
      return request;
    });
    await this.notifications.leaveRequested(created, actor.id);
    return created;
  }

  async review(id: string, dto: ReviewDto, actor: AuthenticatedUser, ctx: RequestContext) {
    const request = await this.getScoped(id, actor);
    if (request.status !== 'PENDING')
      throw new ConflictException(
        apiError('LEAVE_ALREADY_DECIDED', `Request is already ${request.status}`, {
          status: request.status,
        }),
      );
    if (request.employeeId === actor.employeeId)
      throw new ForbiddenException(
        apiError('LEAVE_SELF_REVIEW', 'You cannot review your own request'),
      );
    // The balance may have changed since the request was filed (another approval, an
    // adjustment, a new contract type): it must still fit when it is approved.
    if (dto.decision === 'APPROVED' && request.type === 'VACATION') {
      await this.vacations.assertAffordable(request);
    }

    const reviewed = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.leaveRequest.update({
        where: { id },
        data: {
          status: dto.decision,
          reviewedById: actor.id,
          reviewedAt: new Date(),
          reviewNote: dto.note,
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'leave.reviewed',
          entity: 'LeaveRequest',
          entityId: id,
          context: ctx,
          metadata: { ...dto },
        },
        tx,
      );
      return updated;
    });
    if (dto.decision === 'APPROVED') await this.recomputeAffectedDays(reviewed);
    await this.notifications.leaveReviewed(reviewed, actor.id);
    return reviewed;
  }

  async cancel(id: string, actor: AuthenticatedUser, ctx: RequestContext) {
    const request = await this.getScoped(id, actor);
    if (request.status === 'CANCELLED' || request.status === 'REJECTED') {
      throw new ConflictException(
        apiError('LEAVE_ALREADY_DECIDED', `Request is already ${request.status}`, {
          status: request.status,
        }),
      );
    }
    const wasApproved = request.status === 'APPROVED';
    const isRequester = request.requestedById === actor.id;
    if (!isRequester && !this.scope.isUnrestricted(actor)) {
      throw new ForbiddenException(
        apiError('LEAVE_CANCEL_FORBIDDEN', 'Only the requester or HR can cancel this request'),
      );
    }

    const cancelled = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.leaveRequest.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'update',
          entity: 'LeaveRequest',
          entityId: id,
          context: ctx,
          metadata: { status: 'CANCELLED' },
        },
        tx,
      );
      return updated;
    });
    if (wasApproved) await this.recomputeAffectedDays(cancelled);
    return cancelled;
  }

  private async getScoped(id: string, actor: AuthenticatedUser): Promise<LeaveRequest> {
    const request = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!request)
      throw new NotFoundException(apiError('LEAVE_NOT_FOUND', 'Leave request not found'));
    await this.scope.assertCanAccessEmployee(actor, request.employeeId);
    return request;
  }

  /** Past and current days covered by the leave are re-evaluated immediately. */
  private async recomputeAffectedDays(request: LeaveRequest): Promise<void> {
    const timezone = await this.settings.getTimezone();
    const today = todayIn(timezone);
    const from = addDays(localDateOf(request.startsAt, timezone), -1);
    const toLocal = localDateOf(request.endsAt, timezone);
    const to = toLocal < today ? toLocal : today;
    if (from > to) return;
    await this.processing.recomputeRange({ from, to, employeeIds: [request.employeeId] });
  }
}
