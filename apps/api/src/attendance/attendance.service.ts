import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AccessScopeService } from '../common/access/access-scope.service';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { paginate, skipTake } from '../common/dto/pagination.dto';
import { eachDate, fromDbDate, localDayBounds, toDbDate } from '../common/utils/date-only';
import { buildDedupKey } from '../common/utils/dedup-key';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import {
  AttendanceEventsPublisher,
  EVENT_WITH_RELATIONS,
  toEventPayload,
} from './attendance-events.publisher';
import { AttendanceProcessingService } from './attendance-processing.service';
import type {
  CreateManualEventDto,
  EventsQueryDto,
  RecomputeDto,
  RecordsQueryDto,
  VoidEventDto,
} from './dto/attendance.dto';

const MAX_RANGE_DAYS = 31;
const FUTURE_TOLERANCE_MS = 5 * 60_000;

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: AccessScopeService,
    private readonly settings: SettingsService,
    private readonly processing: AttendanceProcessingService,
    private readonly publisher: AttendanceEventsPublisher,
    private readonly audit: AuditService,
  ) {}

  async listRecords(query: RecordsQueryDto, user: AuthenticatedUser) {
    assertRange(query.from, query.to, 93);
    const where: Prisma.AttendanceRecordWhereInput = {
      workDate: { gte: toDbDate(query.from), lte: toDbDate(query.to) },
      employeeId: query.employeeId,
      status: query.status,
      employee: {
        AND: [
          this.scope.employeeWhere(user) ?? {},
          query.departmentId ? { departmentId: query.departmentId } : {},
        ],
      },
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.attendanceRecord.findMany({
        where,
        orderBy: [{ workDate: 'desc' }, { employee: { lastName: 'asc' } }],
        include: {
          employee: {
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
              department: { select: { name: true } },
            },
          },
        },
        ...skipTake(query),
      }),
      this.prisma.attendanceRecord.count({ where }),
    ]);
    return paginate(
      rows.map((r) => ({ ...r, workDate: fromDbDate(r.workDate) })),
      total,
      query,
    );
  }

  async listEvents(query: EventsQueryDto, user: AuthenticatedUser) {
    assertRange(query.from, query.to, 93);
    const timezone = await this.settings.getTimezone();
    const restricted = !this.scope.isUnrestricted(user);
    if (query.unmatched && restricted)
      throw new BadRequestException('Not allowed to list unmatched punches');

    const employeeFilters: Prisma.EmployeeWhereInput[] = [];
    const scoped = this.scope.employeeWhere(user);
    if (scoped) employeeFilters.push(scoped);
    if (query.departmentId) employeeFilters.push({ departmentId: query.departmentId });

    const where: Prisma.AttendanceEventWhereInput = {
      occurredAt: {
        gte: localDayBounds(query.from, timezone).from,
        lt: localDayBounds(query.to, timezone).to,
      },
      employeeId: query.unmatched ? null : query.employeeId,
      deviceId: query.deviceId,
      employee: employeeFilters.length > 0 ? { AND: employeeFilters } : undefined,
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.attendanceEvent.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        ...EVENT_WITH_RELATIONS,
        ...skipTake(query),
      }),
      this.prisma.attendanceEvent.count({ where }),
    ]);
    const data = rows.map((r) => ({
      ...toEventPayload(r),
      source: r.source,
      verifyMode: r.verifyMode,
      note: r.note,
      voidedAt: r.voidedAt,
      voidReason: r.voidReason,
    }));
    return paginate(data, total, query);
  }

  /** HR correction for a forgotten punch. Never edits device data: it adds a MANUAL event. */
  async createManualEvent(
    dto: CreateManualEventDto,
    actor: AuthenticatedUser,
    ctx: RequestContext,
  ) {
    await this.scope.assertCanAccessEmployee(actor, dto.employeeId);
    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, deletedAt: null },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const occurredAt = new Date(dto.occurredAt);
    if (occurredAt.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
      throw new BadRequestException('A punch cannot be registered in the future');
    }

    const dedupKey = buildDedupKey({
      source: 'MANUAL',
      scope: 'manual',
      subject: employee.id,
      occurredAt,
    });
    const existing = await this.prisma.attendanceEvent.findUnique({ where: { dedupKey } });
    if (existing) throw new ConflictException('A manual punch already exists at that time');

    const event = await this.prisma.$transaction(async (tx) => {
      const created = await tx.attendanceEvent.create({
        data: {
          employeeId: employee.id,
          deviceUserId: employee.biometricId ?? `manual:${employee.employeeCode}`,
          occurredAt,
          punchType: dto.punchType ?? 'UNKNOWN',
          source: 'MANUAL',
          dedupKey,
          note: dto.reason,
          createdById: actor.id,
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'attendance.manual_event',
          entity: 'AttendanceEvent',
          entityId: created.id,
          context: ctx,
          metadata: {
            employeeId: employee.id,
            occurredAt: dto.occurredAt,
            punchType: created.punchType,
            reason: dto.reason,
          },
        },
        tx,
      );
      return created;
    });

    await this.processing.processEvents([event]);
    await this.publisher.publishCreated([event.id]);
    return event;
  }

  /** Voiding keeps the original row (and why it was discarded) for the audit trail. */
  async voidEvent(id: string, dto: VoidEventDto, actor: AuthenticatedUser, ctx: RequestContext) {
    const event = await this.prisma.attendanceEvent.findUnique({ where: { id } });
    if (!event) throw new NotFoundException('Event not found');
    if (event.employeeId) await this.scope.assertCanAccessEmployee(actor, event.employeeId);
    if (event.voidedAt) throw new ConflictException('Event is already voided');

    const voided = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.attendanceEvent.update({
        where: { id },
        data: { voidedAt: new Date(), voidReason: dto.reason },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'attendance.event_voided',
          entity: 'AttendanceEvent',
          entityId: id,
          context: ctx,
          metadata: { reason: dto.reason },
        },
        tx,
      );
      return updated;
    });
    await this.processing.processEvents([event]);
    return voided;
  }

  async recompute(dto: RecomputeDto, actor: AuthenticatedUser, ctx: RequestContext) {
    assertRange(dto.from, dto.to, MAX_RANGE_DAYS);
    if (dto.employeeId) await this.scope.assertCanAccessEmployee(actor, dto.employeeId);
    const result = await this.processing.recomputeRange({
      from: dto.from,
      to: dto.to,
      employeeIds: dto.employeeId ? [dto.employeeId] : undefined,
    });
    await this.audit.record({
      actorId: actor.id,
      action: 'attendance.recompute',
      entity: 'AttendanceRecord',
      context: ctx,
      metadata: { ...dto, ...result },
    });
    return result;
  }
}

function assertRange(from: string, to: string, maxDays: number): void {
  if (from > to) throw new BadRequestException('"from" must be before or equal to "to"');
  if (eachDate(from, to).length > maxDays) {
    throw new BadRequestException(`Date range cannot exceed ${maxDays} days`);
  }
}
