import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PRIVILEGED_ROLES, type Role } from '@asistcontrol/shared';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { paginate, skipTake } from '../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateUserDto, UpdateUserDto, UserQueryDto } from './dto/user.dto';

/** Never select passwordHash: the public shape of a user is defined once, here. */
const PUBLIC_USER = {
  id: true,
  email: true,
  role: true,
  isActive: true,
  employeeId: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  async list(query: UserQueryDto) {
    const where: Prisma.UserWhereInput = {
      role: query.role,
      email: query.search ? { contains: query.search, mode: 'insensitive' } : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: PUBLIC_USER,
        orderBy: { email: 'asc' },
        ...skipTake(query),
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  async get(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: PUBLIC_USER });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async create(dto: CreateUserDto, actor: AuthenticatedUser, ctx: RequestContext) {
    assertCanGrant(actor, dto.role);
    const passwordHash = await this.passwords.hash(dto.password);
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: dto.email, passwordHash, role: dto.role, employeeId: dto.employeeId },
        select: PUBLIC_USER,
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'create',
          entity: 'User',
          entityId: user.id,
          context: ctx,
          metadata: { email: user.email, role: user.role },
        },
        tx,
      );
      return user;
    });
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthenticatedUser, ctx: RequestContext) {
    const current = await this.get(id);
    if (id === actor.id && (dto.role || dto.isActive === false)) {
      throw new BadRequestException('You cannot change your own role or deactivate yourself');
    }
    // Touching a privileged account or granting a privileged role requires SUPER_ADMIN.
    assertCanGrant(actor, current.role);
    if (dto.role) assertCanGrant(actor, dto.role);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id }, data: dto, select: PUBLIC_USER });
      if (dto.isActive === false) {
        await tx.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      if (dto.role && dto.role !== current.role) {
        await this.audit.record(
          {
            actorId: actor.id,
            action: 'user.role_changed',
            entity: 'User',
            entityId: id,
            context: ctx,
            metadata: { from: current.role, to: dto.role },
          },
          tx,
        );
      }
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'update',
          entity: 'User',
          entityId: id,
          context: ctx,
          metadata: { ...dto },
        },
        tx,
      );
      return user;
    });
  }

  async resetPassword(id: string, password: string, actor: AuthenticatedUser, ctx: RequestContext) {
    const target = await this.get(id);
    assertCanGrant(actor, target.role);
    const passwordHash = await this.passwords.hash(password);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash } });
      // Force re-login everywhere after a password reset.
      await tx.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'update',
          entity: 'User',
          entityId: id,
          context: ctx,
          metadata: { passwordReset: true },
        },
        tx,
      );
    });
  }
}

function assertCanGrant(actor: AuthenticatedUser, role: Role): void {
  if (PRIVILEGED_ROLES.includes(role) && actor.role !== 'SUPER_ADMIN') {
    throw new ForbiddenException('Only a SUPER_ADMIN can manage administrator accounts');
  }
}
