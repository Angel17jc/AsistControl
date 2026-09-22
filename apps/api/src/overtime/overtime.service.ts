import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AccessScopeService } from '../common/access/access-scope.service';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { paginate, skipTake } from '../common/dto/pagination.dto';
import type { ReviewDto } from '../common/dto/review.dto';
import { fromDbDate, toDbDate } from '../common/utils/date-only';
import { PrismaService } from '../prisma/prisma.service';
import type { OvertimeQueryDto } from './overtime.dto';

/**
 * Overtime records are proposed by the attendance engine and must be approved by a person
 * before they are exported to payroll.
 */
@Injectable()
export class OvertimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: AccessScopeService,
    private readonly audit: AuditService,
  ) {}

  async list(query: OvertimeQueryDto, user: AuthenticatedUser) {
    const where: Prisma.OvertimeRecordWhereInput = {
      status: query.status,
      employeeId: query.employeeId,
      workDate: {
        gte: query.from ? toDbDate(query.from) : undefined,
        lte: query.to ? toDbDate(query.to) : undefined,
      },
      ...this.scope.relationWhere(user),
    };
    const [rows, total, sum] = await this.prisma.$transaction([
      this.prisma.overtimeRecord.findMany({
        where,
        orderBy: [{ workDate: 'desc' }],
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        },
        ...skipTake(query),
      }),
      this.prisma.overtimeRecord.count({ where }),
      this.prisma.overtimeRecord.aggregate({ where, _sum: { minutes: true } }),
    ]);
    return {
      ...paginate(
        rows.map((r) => ({ ...r, workDate: fromDbDate(r.workDate) })),
        total,
        query,
      ),
      totalMinutes: sum._sum.minutes ?? 0,
    };
  }

  async review(id: string, dto: ReviewDto, actor: AuthenticatedUser, ctx: RequestContext) {
    const record = await this.prisma.overtimeRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Overtime record not found');
    await this.scope.assertCanAccessEmployee(actor, record.employeeId);
    if (record.employeeId === actor.employeeId)
      throw new ForbiddenException('You cannot approve your own overtime');
    if (record.status !== 'PENDING')
      throw new ConflictException(`Overtime is already ${record.status}`);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.overtimeRecord.update({
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
          action: 'overtime.reviewed',
          entity: 'OvertimeRecord',
          entityId: id,
          context: ctx,
          metadata: { ...dto, minutes: record.minutes },
        },
        tx,
      );
      return { ...updated, workDate: fromDbDate(updated.workDate) };
    });
  }
}
