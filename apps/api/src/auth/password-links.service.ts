import { BadRequestException, Injectable } from '@nestjs/common';
import type { PasswordLinkPurpose, Prisma, User } from '@prisma/client';
import type { PasswordLinkInfo } from '@asistcontrol/shared';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../common/auth/authenticated-user';
import { apiError } from '../common/errors/api-error';
import { LinkMailer } from '../mail/link-mailer';
import { renderPasswordLinkEmail } from '../mail/password-link-email';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { PasswordService } from './password.service';

/** How long a link works: a reset is asked for and used right away; an invitation waits. */
export const LINK_LIFETIME_MS: Record<PasswordLinkPurpose, number> = {
  RESET: 30 * 60_000,
  INVITE: 72 * 3_600_000,
};
/** One reset email per account at most this often, however many times it is asked for. */
export const RESET_COOLDOWN_MS = 60_000;

/** Where the web app opens a link. The token goes after `#`: browsers never send it. */
export const PASSWORD_LINK_PATH = '/restablecer';

/**
 * Single-use links to choose a password (ADR 0016): "olvidé mi contraseña" and invitations.
 * The token is 32 random bytes; only its SHA-256 is stored. A link dies when used, when a
 * newer one of the same account is issued, when the password changes any other way, or when
 * it expires.
 */
@Injectable()
export class PasswordLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly mailer: LinkMailer,
  ) {}

  /** Whether links can reach people at all (see LinkMailer). */
  get available(): boolean {
    return this.mailer.delivery !== 'off';
  }

  /**
   * "Olvidé mi contraseña". The answer never says whether the address has an account, an
   * inactive one, or was just sent a link: the caller always hears "if it exists, we sent it".
   */
  async requestReset(email: string, ctx: RequestContext, now = new Date()): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const recent =
      user &&
      (await this.prisma.passwordLink.findFirst({
        where: {
          userId: user.id,
          purpose: 'RESET',
          createdAt: { gt: new Date(now.getTime() - RESET_COOLDOWN_MS) },
        },
        select: { id: true },
      }));
    const skipped = !this.available
      ? 'email_off'
      : !user
        ? 'unknown_user'
        : !user.isActive
          ? 'inactive'
          : recent
            ? 'cooldown'
            : null;
    this.audit.recordAsync({
      actorId: null,
      action: 'auth.password_reset_requested',
      entity: 'User',
      entityId: user?.id ?? null,
      context: ctx,
      metadata: { email, sent: skipped === null, ...(skipped && { reason: skipped }) },
    });
    if (skipped || !user) return;

    const { token, expiresAt } = await this.issue(this.prisma, user.id, 'RESET', null, now);
    void this.send(user, 'RESET', token, expiresAt);
  }

  /**
   * A new invitation link for an account an administrator created (or re-sent). Runs inside
   * the caller's transaction; the email goes out once `send` is called after it commits.
   */
  issueInvitation(
    tx: Prisma.TransactionClient,
    userId: string,
    createdById: string,
    now = new Date(),
  ) {
    return this.issue(tx, userId, 'INVITE', createdById, now);
  }

  /** What a link opens, so the page can say whose password it sets before asking for it. */
  async inspect(token: string, now = new Date()): Promise<PasswordLinkInfo> {
    const link = await this.findUsable(this.prisma, token, now);
    return {
      email: link.user.email,
      purpose: link.purpose,
      expiresAt: link.expiresAt.toISOString(),
    };
  }

  /**
   * Sets the password the link was sent for. Every session of the account ends (whoever
   * knew the old password is out) and every other link of the account dies.
   */
  async complete(
    token: string,
    newPassword: string,
    ctx: RequestContext,
    now = new Date(),
  ): Promise<void> {
    const passwordHash = await this.passwords.hash(newPassword);
    await this.prisma.$transaction(async (tx) => {
      const link = await this.findUsable(tx, token, now);
      // Compare-and-set: two tabs submitting the same link, only one wins.
      const claimed = await tx.passwordLink.updateMany({
        where: { id: link.id, usedAt: null },
        data: { usedAt: now },
      });
      if (claimed.count === 0) throw invalidLink();

      await tx.user.update({
        where: { id: link.userId },
        data: { passwordHash, mustChangePassword: false },
      });
      await PasswordLinksService.retireLinks(tx, link.userId, now);
      const revoked = await tx.session.updateMany({
        where: { userId: link.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.audit.record(
        {
          actorId: link.userId,
          action: link.purpose === 'INVITE' ? 'auth.invitation_accepted' : 'auth.password_reset',
          entity: 'User',
          entityId: link.userId,
          context: ctx,
          metadata: { sessionsRevoked: revoked.count },
        },
        tx,
      );
    });
  }

  /** Emails a link. Never awaited by a request (see LinkMailer.dispatch). */
  async send(
    user: Pick<User, 'id' | 'email'>,
    purpose: PasswordLinkPurpose,
    token: string,
    expiresAt: Date,
    invitedBy?: string,
  ): Promise<void> {
    const appUrl = this.mailer.appUrl;
    if (!appUrl) return;
    const email = renderPasswordLinkEmail({
      purpose,
      email: user.email,
      link: `${appUrl}${PASSWORD_LINK_PATH}#${token}`,
      expiresAt,
      timezone: await this.settings.getTimezone(),
      invitedBy,
    });
    await this.mailer.dispatch({ to: user.email, ...email }, `password-link:${purpose}`);
  }

  /** Kills every unused link of an account: its password just changed some other way. */
  static retireLinks(tx: Prisma.TransactionClient, userId: string, now = new Date()) {
    return tx.passwordLink.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: now },
    });
  }

  private async issue(
    tx: Prisma.TransactionClient,
    userId: string,
    purpose: PasswordLinkPurpose,
    createdById: string | null,
    now: Date,
  ) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + LINK_LIFETIME_MS[purpose]);
    // Only the newest link of an account works.
    await PasswordLinksService.retireLinks(tx, userId, now);
    await tx.passwordLink.create({
      data: { userId, purpose, tokenHash: hashToken(token), expiresAt, createdById },
    });
    return { token, expiresAt };
  }

  private async findUsable(tx: Prisma.TransactionClient, token: string, now: Date) {
    const link = await tx.passwordLink.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: { email: true, isActive: true } } },
    });
    if (!link || link.usedAt || !link.user.isActive) throw invalidLink();
    if (link.expiresAt <= now) {
      throw new BadRequestException(
        apiError('PASSWORD_LINK_EXPIRED', 'This password link has expired', {
          purpose: link.purpose,
        }),
      );
    }
    return link;
  }
}

function invalidLink() {
  return new BadRequestException(
    apiError('PASSWORD_LINK_INVALID', 'This password link is not valid any more'),
  );
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
