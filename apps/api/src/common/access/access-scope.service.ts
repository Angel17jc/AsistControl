import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';

/**
 * Row-level data scoping. RBAC answers "can this role read attendance?";
 * this answers "whose attendance?".
 *  - SUPER_ADMIN / ADMIN / HR: everyone
 *  - SUPERVISOR: self + direct reports
 *  - EMPLOYEE: self only
 */
@Injectable()
export class AccessScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Prisma filter on Employee; `undefined` means unrestricted. */
  employeeWhere(user: AuthenticatedUser): Prisma.EmployeeWhereInput | undefined {
    switch (user.role) {
      case 'SUPER_ADMIN':
      case 'ADMIN':
      case 'HR':
        return undefined;
      case 'SUPERVISOR':
        return user.employeeId
          ? { OR: [{ id: user.employeeId }, { supervisorId: user.employeeId }] }
          : { id: { in: [] } };
      case 'EMPLOYEE':
        return { id: user.employeeId ?? '00000000-0000-0000-0000-000000000000' };
    }
  }

  /** Filter for models that have an `employee` relation (records, requests…). */
  relationWhere(user: AuthenticatedUser): { employee?: Prisma.EmployeeWhereInput } {
    const where = this.employeeWhere(user);
    return where ? { employee: where } : {};
  }

  async assertCanAccessEmployee(user: AuthenticatedUser, employeeId: string): Promise<void> {
    const where = this.employeeWhere(user);
    if (!where) return;
    const visible = await this.prisma.employee.count({
      where: { AND: [where, { id: employeeId }] },
    });
    if (visible === 0) throw new ForbiddenException('You cannot access this employee');
  }

  isUnrestricted(user: AuthenticatedUser): boolean {
    return this.employeeWhere(user) === undefined;
  }
}
