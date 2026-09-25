import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AttendanceProcessingService } from '../attendance/attendance-processing.service';
import { AuditService, diff } from '../audit/audit.service';
import { AccessScopeService } from '../common/access/access-scope.service';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { paginate, skipTake } from '../common/dto/pagination.dto';
import { fromDbDate, toDbDate } from '../common/utils/date-only';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateEmployeeDto, EmployeeQueryDto, UpdateEmployeeDto } from './employees.dto';

const EMPLOYEE_INCLUDE = {
  department: { select: { id: true, name: true, code: true } },
  position: { select: { id: true, name: true } },
  contractType: { select: { id: true, name: true } },
  supervisor: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.EmployeeInclude;

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: AccessScopeService,
    private readonly audit: AuditService,
    private readonly processing: AttendanceProcessingService,
  ) {}

  async list(query: EmployeeQueryDto, user: AuthenticatedUser) {
    const search = query.search?.trim();
    const where: Prisma.EmployeeWhereInput = {
      AND: [
        { deletedAt: null, status: query.status, departmentId: query.departmentId },
        this.scope.employeeWhere(user) ?? {},
        search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { employeeCode: { contains: search, mode: 'insensitive' } },
                { identification: { contains: search } },
              ],
            }
          : {},
      ],
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where,
        include: EMPLOYEE_INCLUDE,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        ...skipTake(query),
      }),
      this.prisma.employee.count({ where }),
    ]);
    return paginate(rows.map(serialize), total, query);
  }

  async get(id: string, user: AuthenticatedUser) {
    await this.scope.assertCanAccessEmployee(user, id);
    const employee = await this.prisma.employee.findFirst({
      where: { id, deletedAt: null },
      include: EMPLOYEE_INCLUDE,
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return serialize(employee);
  }

  async create(dto: CreateEmployeeDto, actor: AuthenticatedUser, ctx: RequestContext) {
    await this.assertReferences(dto);
    const employee = await this.prisma.$transaction(async (tx) => {
      const created = await tx.employee.create({
        data: { ...dto, hireDate: toDbDate(dto.hireDate) },
        include: EMPLOYEE_INCLUDE,
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'create',
          entity: 'Employee',
          entityId: created.id,
          context: ctx,
          metadata: { ...dto },
        },
        tx,
      );
      return created;
    });
    if (dto.biometricId) await this.linkUnmatchedPunches(employee.id, dto.biometricId);
    return serialize(employee);
  }

  async update(id: string, dto: UpdateEmployeeDto, actor: AuthenticatedUser, ctx: RequestContext) {
    const before = await this.prisma.employee.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Employee not found');
    if (dto.supervisorId === id)
      throw new BadRequestException('An employee cannot supervise themselves');
    await this.assertReferences(dto, id);

    const employee = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.employee.update({
        where: { id },
        data: {
          ...dto,
          hireDate: dto.hireDate ? toDbDate(dto.hireDate) : undefined,
          // null clears the date (a reinstatement), undefined leaves it untouched.
          terminatedAt:
            dto.terminatedAt === null
              ? null
              : dto.terminatedAt
                ? toDbDate(dto.terminatedAt)
                : undefined,
        },
        include: EMPLOYEE_INCLUDE,
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'update',
          entity: 'Employee',
          entityId: id,
          context: ctx,
          metadata: diff(serialize(before), { ...dto }),
        },
        tx,
      );
      return updated;
    });

    if (dto.biometricId && dto.biometricId !== before.biometricId) {
      await this.linkUnmatchedPunches(id, dto.biometricId);
    }
    return serialize(employee);
  }

  /**
   * Soft delete. The employee disappears from lists but attendance, overtime, payroll
   * exports and the audit trail keep their references intact.
   */
  async remove(id: string, actor: AuthenticatedUser, ctx: RequestContext): Promise<void> {
    const employee = await this.prisma.employee.findFirst({ where: { id, deletedAt: null } });
    if (!employee) throw new NotFoundException('Employee not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id },
        // Release the biometric id so it can be enrolled for someone else.
        data: { deletedAt: new Date(), status: 'INACTIVE', biometricId: null },
      });
      await tx.user.updateMany({ where: { employeeId: id }, data: { isActive: false } });
      await tx.employee.updateMany({ where: { supervisorId: id }, data: { supervisorId: null } });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'delete',
          entity: 'Employee',
          entityId: id,
          context: ctx,
          metadata: { employeeCode: employee.employeeCode, biometricId: employee.biometricId },
        },
        tx,
      );
    });
  }

  /**
   * Punches received before the employee was enrolled in the system are stored unmatched.
   * When the biometric id becomes known they are linked and the affected days recomputed.
   */
  private async linkUnmatchedPunches(employeeId: string, biometricId: string): Promise<void> {
    const pending = await this.prisma.attendanceEvent.findMany({
      where: { employeeId: null, deviceUserId: biometricId, source: 'DEVICE' },
      select: { id: true, occurredAt: true },
    });
    if (pending.length === 0) return;
    await this.prisma.attendanceEvent.updateMany({
      where: { id: { in: pending.map((p) => p.id) } },
      data: { employeeId },
    });
    await this.processing.processEvents(
      pending.map((p) => ({ employeeId, occurredAt: p.occurredAt })),
    );
  }

  private async assertReferences(dto: Partial<CreateEmployeeDto>, selfId?: string): Promise<void> {
    const checks: Promise<void>[] = [];
    if (dto.departmentId) {
      checks.push(
        this.exists(
          this.prisma.department.count({ where: { id: dto.departmentId, deletedAt: null } }),
          'Department',
        ),
      );
    }
    if (dto.contractTypeId) {
      checks.push(
        this.exists(
          this.prisma.contractType.count({ where: { id: dto.contractTypeId } }),
          'Contract type',
        ),
      );
    }
    if (dto.positionId) {
      checks.push(
        this.exists(
          this.prisma.position.count({ where: { id: dto.positionId, deletedAt: null } }),
          'Position',
        ),
      );
    }
    if (dto.supervisorId) {
      checks.push(
        this.exists(
          this.prisma.employee.count({
            where: {
              id: dto.supervisorId,
              deletedAt: null,
              NOT: selfId ? { id: selfId } : undefined,
            },
          }),
          'Supervisor',
        ),
      );
    }
    await Promise.all(checks);
  }

  private async exists(count: Promise<number>, label: string): Promise<void> {
    if ((await count) === 0) throw new BadRequestException(`${label} does not exist`);
  }
}

function serialize<T extends { hireDate: Date; terminatedAt: Date | null }>(employee: T) {
  return {
    ...employee,
    hireDate: fromDbDate(employee.hireDate),
    terminatedAt: employee.terminatedAt ? fromDbDate(employee.terminatedAt) : null,
  };
}
