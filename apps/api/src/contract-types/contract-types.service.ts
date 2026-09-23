import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ContractType, Prisma } from '@prisma/client';
import { AuditService, diff } from '../audit/audit.service';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import type { VacationRule } from '../vacations/domain/vacation-entitlement';
import type { CreateContractTypeDto, UpdateContractTypeDto } from './contract-types.dto';

/** API shape: decimals as numbers and the seniority columns as one object (or null). */
export function toContractTypeResponse(row: ContractType, employees?: number) {
  return {
    id: row.id,
    name: row.name,
    vacationDaysPerYear: Number(row.vacationDaysPerYear),
    vacationAccrual: row.vacationAccrual,
    vacationDayCounting: row.vacationDayCounting,
    seniority:
      row.seniorityAfterYears === null
        ? null
        : {
            afterYears: row.seniorityAfterYears,
            extraDaysPerYear: Number(row.seniorityExtraDaysPerYear),
            maxExtraDays: Number(row.seniorityMaxExtraDays),
          },
    allowNegativeVacationBalance: row.allowNegativeVacationBalance,
    ...(employees !== undefined && { employees }),
  };
}

/** The entitlement rule the pure vacation domain works with. */
export function vacationRuleOf(row: ContractType): VacationRule {
  const { vacationDaysPerYear, vacationAccrual, seniority } = toContractTypeResponse(row);
  return { daysPerYear: vacationDaysPerYear, accrual: vacationAccrual, seniority };
}

/**
 * Employment terms that decide vacation entitlement. Company policy, not law: the values a
 * company uses (base days, seniority bonus…) are data, so a change of rules is an edit.
 */
@Injectable()
export class ContractTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const rows = await this.prisma.contractType.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { employees: { where: { deletedAt: null } } } } },
    });
    return rows.map((row) => toContractTypeResponse(row, row._count.employees));
  }

  async get(id: string) {
    return toContractTypeResponse(await this.entity(id));
  }

  async create(dto: CreateContractTypeDto, actor: AuthenticatedUser, ctx: RequestContext) {
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.contractType.create({
        data: toData(dto) as Prisma.ContractTypeCreateInput,
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'create',
          entity: 'ContractType',
          entityId: row.id,
          context: ctx,
          metadata: { ...dto },
        },
        tx,
      );
      return row;
    });
    return toContractTypeResponse(created);
  }

  async update(
    id: string,
    dto: UpdateContractTypeDto,
    actor: AuthenticatedUser,
    ctx: RequestContext,
  ) {
    const before = await this.entity(id);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.contractType.update({ where: { id }, data: toData(dto) });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'update',
          entity: 'ContractType',
          entityId: id,
          context: ctx,
          metadata: diff(toContractTypeResponse(before), toContractTypeResponse(row)),
        },
        tx,
      );
      return row;
    });
    return toContractTypeResponse(updated);
  }

  /** Refused while employees use it: their balances would silently disappear. */
  async remove(id: string, actor: AuthenticatedUser, ctx: RequestContext): Promise<void> {
    const row = await this.entity(id);
    const employees = await this.prisma.employee.count({
      where: { contractTypeId: id, deletedAt: null },
    });
    if (employees > 0) {
      throw new ConflictException(
        `Contract type "${row.name}" is used by ${employees} employee(s); reassign them first`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.contractType.delete({ where: { id } });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'delete',
          entity: 'ContractType',
          entityId: id,
          context: ctx,
          metadata: { name: row.name },
        },
        tx,
      );
    });
  }

  private async entity(id: string): Promise<ContractType> {
    const row = await this.prisma.contractType.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Contract type not found');
    return row;
  }
}

function toData(dto: UpdateContractTypeDto): Prisma.ContractTypeUpdateInput {
  const { seniority, ...rest } = dto;
  return {
    ...rest,
    // Seniority is all or nothing: `null` removes the bonus, an object replaces it.
    ...(seniority !== undefined && {
      seniorityAfterYears: seniority?.afterYears ?? null,
      seniorityExtraDaysPerYear: seniority?.extraDaysPerYear ?? null,
      seniorityMaxExtraDays: seniority?.maxExtraDays ?? null,
    }),
  };
}
