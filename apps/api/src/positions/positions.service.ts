import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService, diff } from '../audit/audit.service';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import type { CreatePositionDto, UpdatePositionDto } from './positions.dto';

@Injectable()
export class PositionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.position.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } });
  }

  async get(id: string) {
    const position = await this.prisma.position.findFirst({ where: { id, deletedAt: null } });
    if (!position) throw new NotFoundException('Position not found');
    return position;
  }

  create(dto: CreatePositionDto, actor: AuthenticatedUser, ctx: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const position = await tx.position.create({ data: dto });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'create',
          entity: 'Position',
          entityId: position.id,
          context: ctx,
          metadata: { ...dto },
        },
        tx,
      );
      return position;
    });
  }

  async update(id: string, dto: UpdatePositionDto, actor: AuthenticatedUser, ctx: RequestContext) {
    const before = await this.get(id);
    return this.prisma.$transaction(async (tx) => {
      const position = await tx.position.update({ where: { id }, data: dto });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'update',
          entity: 'Position',
          entityId: id,
          context: ctx,
          metadata: diff(before, { ...dto }),
        },
        tx,
      );
      return position;
    });
  }

  async remove(id: string, actor: AuthenticatedUser, ctx: RequestContext): Promise<void> {
    const position = await this.get(id);
    const employees = await this.prisma.employee.count({
      where: { positionId: id, deletedAt: null },
    });
    if (employees > 0)
      throw new ConflictException(`Position is assigned to ${employees} employee(s)`);
    await this.prisma.$transaction(async (tx) => {
      await tx.position.update({
        where: { id },
        data: { deletedAt: new Date(), name: `${position.name}#deleted-${Date.now()}` },
      });
      await this.audit.record(
        { actorId: actor.id, action: 'delete', entity: 'Position', entityId: id, context: ctx },
        tx,
      );
    });
  }
}
