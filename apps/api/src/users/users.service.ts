import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PRIVILEGED_ROLES, type Role, SCOPED_ROLES } from '@asistcontrol/shared';
import { AuditService } from '../audit/audit.service';
import { PasswordLinksService } from '../auth/password-links.service';
import { PasswordService } from '../auth/password.service';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { paginate, skipTake } from '../common/dto/pagination.dto';
import { apiError } from '../common/errors/api-error';
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
  mustChangePassword: true,
  createdAt: true,
  updatedAt: true,
  employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
  // A pending invitation: the newest unused one (ADR 0016).
  passwordLinks: {
    where: { purpose: 'INVITE', usedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { expiresAt: true },
  },
} satisfies Prisma.UserSelect;

type SelectedUser = Prisma.UserGetPayload<{ select: typeof PUBLIC_USER }>;

/** `invitation` is set while an invitation waits to be used, expired or not. */
function toPublic({ passwordLinks, ...user }: SelectedUser, now = new Date()) {
  const pending = passwordLinks[0];
  return {
    ...user,
    invitation: pending
      ? { expiresAt: pending.expiresAt, expired: pending.expiresAt <= now }
      : null,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly links: PasswordLinksService,
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
    return paginate(
      items.map((user) => toPublic(user)),
      total,
      query,
    );
  }

  async get(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: PUBLIC_USER });
    if (!user) throw new NotFoundException(apiError('USER_NOT_FOUND', 'User not found'));
    return toPublic(user);
  }

  /**
   * A new account. Either with a temporary password the administrator passes on (its owner
   * replaces it when signing in), or with an invitation: an email with a link to choose the
   * password (ADR 0016). An invited account gets a random password nobody knows meanwhile.
   */
  async create(dto: CreateUserDto, actor: AuthenticatedUser, ctx: RequestContext) {
    assertCanGrant(actor, dto.role);
    assertScopedRoleHasEmployee(dto.role, dto.employeeId ?? null);
    const invite = dto.invite === true;
    if (invite) this.assertLinksAvailable();
    const passwordHash = await this.passwords.hash(
      invite ? randomBytes(32).toString('base64url') : dto.password!,
    );
    const { user, link } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          role: dto.role,
          employeeId: dto.employeeId,
          mustChangePassword: !invite,
        },
        select: { id: true },
      });
      const link = invite ? await this.links.issueInvitation(tx, created.id, actor.id) : null;
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'create',
          entity: 'User',
          entityId: created.id,
          context: ctx,
          metadata: { email: dto.email, role: dto.role, invited: invite },
        },
        tx,
      );
      const user = await tx.user.findUniqueOrThrow({
        where: { id: created.id },
        select: PUBLIC_USER,
      });
      return { user, link };
    });
    if (link) void this.sendInvitation(user, link, actor);
    return toPublic(user);
  }

  /**
   * Sends a new invitation to an account that never signed in (the first one expired, or
   * went to spam). The previous link stops working.
   */
  async resendInvitation(id: string, actor: AuthenticatedUser, ctx: RequestContext) {
    const target = await this.get(id);
    assertCanGrant(actor, target.role);
    if (target.lastLoginAt) {
      throw new ConflictException(
        apiError('INVITATION_NOT_NEEDED', 'This account already signed in'),
      );
    }
    if (!target.isActive) {
      throw new ConflictException(apiError('INVITATION_NOT_NEEDED', 'This account is disabled'));
    }
    this.assertLinksAvailable();
    // A temporary password given before must not keep working next to the invitation.
    const passwordHash = await this.passwords.hash(randomBytes(32).toString('base64url'));
    const link = await this.prisma.$transaction(async (tx) => {
      const issued = await this.links.issueInvitation(tx, id, actor.id);
      await tx.user.update({ where: { id }, data: { passwordHash, mustChangePassword: false } });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'auth.invitation_sent',
          entity: 'User',
          entityId: id,
          context: ctx,
          metadata: { email: target.email, resent: true },
        },
        tx,
      );
      return issued;
    });
    void this.sendInvitation(target, link, actor);
    return { expiresAt: link.expiresAt };
  }

  private assertLinksAvailable() {
    if (!this.links.available) {
      throw new BadRequestException(
        apiError('PASSWORD_LINKS_UNAVAILABLE', 'This server cannot email password links'),
      );
    }
  }

  /** Signs the invitation with the inviter's name when they have an employee record. */
  private async sendInvitation(
    user: { id: string; email: string },
    link: { token: string; expiresAt: Date },
    actor: AuthenticatedUser,
  ): Promise<void> {
    const inviter = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { employee: { select: { firstName: true, lastName: true } } },
    });
    const name = inviter?.employee
      ? `${inviter.employee.firstName} ${inviter.employee.lastName}`
      : actor.email;
    await this.links.send(user, 'INVITE', link.token, link.expiresAt, name);
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthenticatedUser, ctx: RequestContext) {
    const current = await this.get(id);
    if (id === actor.id && (dto.role || dto.isActive === false)) {
      throw new BadRequestException(
        apiError('SELF_ACCOUNT_CHANGE', 'You cannot change your own role or deactivate yourself'),
      );
    }
    // Touching a privileged account or granting a privileged role requires SUPER_ADMIN.
    assertCanGrant(actor, current.role);
    if (dto.role) assertCanGrant(actor, dto.role);
    // Judged on the account as it would end up: a new role, a new link, or both. Not `??`:
    // employeeId null means "unlink", only an absent one keeps the current link.
    assertScopedRoleHasEmployee(
      dto.role ?? current.role,
      dto.employeeId === undefined ? current.employeeId : dto.employeeId,
    );

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
      return toPublic(user);
    });
  }

  async resetPassword(id: string, password: string, actor: AuthenticatedUser, ctx: RequestContext) {
    const target = await this.get(id);
    assertCanGrant(actor, target.role);
    const passwordHash = await this.passwords.hash(password);
    await this.prisma.$transaction(async (tx) => {
      // Someone else now knows it: the owner must replace it. Resetting your own is just a change.
      await tx.user.update({
        where: { id },
        data: { passwordHash, mustChangePassword: id !== actor.id },
      });
      // Force re-login everywhere after a password reset.
      await tx.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      // A pending "forgot password" link or invitation would undo it.
      await PasswordLinksService.retireLinks(tx, id);
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

/**
 * A supervisor or an employee sees data through their linked employee (row scope, ADR 0003):
 * without one, the account could sign in and see nothing at all.
 */
function assertScopedRoleHasEmployee(role: Role, employeeId: string | null): void {
  if (SCOPED_ROLES.includes(role) && !employeeId) {
    throw new BadRequestException(
      apiError('ACCOUNT_NEEDS_EMPLOYEE', `A ${role} account must be linked to an employee`, {
        role,
      }),
    );
  }
}

function assertCanGrant(actor: AuthenticatedUser, role: Role): void {
  if (PRIVILEGED_ROLES.includes(role) && actor.role !== 'SUPER_ADMIN') {
    throw new ForbiddenException(
      apiError('ADMIN_ACCOUNTS_RESTRICTED', 'Only a SUPER_ADMIN can manage administrator accounts'),
    );
  }
}
