import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService, diff } from '../audit/audit.service';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateDepartmentDto, UpdateDepartmentDto } from './departments.dto';

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.department.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      include: { _count: { select: { employees: { where: { deletedAt: null } } } } },
    });
  }

  async get(id: string) {
    const department = await this.prisma.department.findFirst({ where: { id, deletedAt: null } });
    if (!department) throw new NotFoundException('Department not found');
    return department;
  }

  create(dto: CreateDepartmentDto, actor: AuthenticatedUser, ctx: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const department = await tx.department.create({ data: dto });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'create',
          entity: 'Department',
          entityId: department.id,
          context: ctx,
          metadata: { ...dto },
        },
        tx,
      );
      return department;
    });
  }

  async update(
    id: string,
    dto: UpdateDepartmentDto,
    actor: AuthenticatedUser,
    ctx: RequestContext,
  ) {
    const before = await this.get(id);
    return this.prisma.$transaction(async (tx) => {
      const department = await tx.department.update({ where: { id }, data: dto });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'update',
          entity: 'Department',
          entityId: id,
          context: ctx,
          metadata: diff(before, { ...dto }),
        },
        tx,
      );
      return department;
    });
  }

  /** Soft delete; refused while active employees still belong to the department. */
  async remove(id: string, actor: AuthenticatedUser, ctx: RequestContext): Promise<void> {
    const department = await this.get(id);
    const employees = await this.prisma.employee.count({
      where: { departmentId: id, deletedAt: null },
    });
    if (employees > 0) {
      throw new ConflictException(`Department has ${employees} employee(s); reassign them first`);
    }
    await this.prisma.$transaction(async (tx) => {
      // Free the unique code/name so they can be reused by a new department.
      const suffix = `#deleted-${Date.now()}`;
      await tx.department.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          code: department.code + suffix,
          name: department.name + suffix,
        },
      });
      await this.audit.record(
        { actorId: actor.id, action: 'delete', entity: 'Department', entityId: id, context: ctx },
        tx,
      );
    });
  }
}
