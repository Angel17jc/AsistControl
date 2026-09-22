import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import type { AuthSession, AuthUser } from '@asistcontrol/shared';
import { createHash, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import type { AccessTokenPayload, RefreshTokenPayload } from '../common/auth/token-payloads';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';

export interface IssuedSession extends AuthSession {
  refreshToken: string;
  refreshExpiresAt: Date;
}

const INVALID_CREDENTIALS = 'Invalid email or password';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string, ctx: RequestContext): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });

    const valid = user
      ? await this.passwords.verify(user.passwordHash, password)
      : await this.passwords.verifyAgainstDummy(password);

    // Same message and timing for "unknown user", "wrong password" and "disabled account".
    if (!user || !valid || !user.isActive) {
      this.audit.recordAsync({
        actorId: user?.id ?? null,
        action: 'auth.login_failed',
        entity: 'User',
        entityId: user?.id ?? null,
        context: ctx,
        metadata: { email, reason: !user ? 'unknown_user' : !valid ? 'bad_password' : 'inactive' },
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const refreshTtl = this.config.get('JWT_REFRESH_TTL_SECONDS');
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: 'pending',
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
        ip: ctx.ip,
        userAgent: ctx.userAgent?.slice(0, 500),
      },
    });

    const issued = await this.issue(user, session.id, displayName(user));
    await this.prisma.$transaction(async (tx) => {
      await tx.session.update({
        where: { id: session.id },
        data: { refreshTokenHash: sha256(issued.refreshToken) },
      });
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'auth.login',
          entity: 'Session',
          entityId: session.id,
          context: ctx,
        },
        tx,
      );
    });
    return issued;
  }

  /**
   * Refresh token rotation. Each refresh invalidates the previous token; presenting an
   * already-rotated token means it was stolen or replayed, so the whole session is revoked.
   */
  async refresh(refreshToken: string | undefined, ctx: RequestContext): Promise<IssuedSession> {
    if (!refreshToken) throw new UnauthorizedException('Missing refresh token');

    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      });
      if (payload.typ !== 'refresh') throw new Error('wrong type');
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      include: { user: { include: { employee: { select: { firstName: true, lastName: true } } } } },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.isActive) {
      throw new UnauthorizedException('Session expired');
    }

    const issued = await this.issue(session.user, session.id, displayName(session.user));
    // Compare-and-set: only the holder of the *current* token can rotate it, even under races.
    const rotated = await this.prisma.session.updateMany({
      where: { id: session.id, refreshTokenHash: sha256(refreshToken), revokedAt: null },
      data: { refreshTokenHash: sha256(issued.refreshToken), lastUsedAt: new Date() },
    });

    if (rotated.count === 0) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      this.audit.recordAsync({
        actorId: session.userId,
        action: 'auth.refresh_reuse_detected',
        entity: 'Session',
        entityId: session.id,
        context: ctx,
      });
      throw new UnauthorizedException('Session revoked');
    }
    return issued;
  }

  async logout(user: AuthenticatedUser, ctx: RequestContext): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: user.sessionId, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'auth.logout',
      entity: 'Session',
      entityId: user.sessionId,
      context: ctx,
    });
  }

  async me(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    return toAuthUser(user, displayName(user));
  }

  private async issue(user: User, sessionId: string, name: string): Promise<IssuedSession> {
    const accessTtl = this.config.get('JWT_ACCESS_TTL_SECONDS');
    const refreshTtl = this.config.get('JWT_REFRESH_TTL_SECONDS');
    const access: AccessTokenPayload = {
      sub: user.id,
      sid: sessionId,
      email: user.email,
      role: user.role,
      eid: user.employeeId,
      typ: 'access',
    };
    const refresh: RefreshTokenPayload = { sub: user.id, sid: sessionId, typ: 'refresh' };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(access, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
        expiresIn: accessTtl,
      }),
      this.jwt.signAsync(
        { ...refresh, jti: randomUUID() },
        { secret: this.config.get('JWT_REFRESH_SECRET'), expiresIn: refreshTtl },
      ),
    ]);
    return {
      accessToken,
      expiresIn: accessTtl,
      refreshToken,
      refreshExpiresAt: new Date(Date.now() + refreshTtl * 1000),
      user: toAuthUser(user, name),
    };
  }
}

type UserWithEmployee = User & { employee: { firstName: string; lastName: string } | null };

function displayName(user: UserWithEmployee): string {
  return user.employee ? `${user.employee.firstName} ${user.employee.lastName}` : user.email;
}

function toAuthUser(user: User, name: string): AuthUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    employeeId: user.employeeId,
    displayName: name,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
