import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AppConfigService } from '../../config/app-config.service';
import { MAIL_TRANSPORT, type MailTransport } from '../../mail/mail-transport';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { toPayload } from '../notifications.service';
import { EMAIL_MAX_AGE_MS, nextAttemptAfter } from './email-retry';
import { renderNotificationEmail } from './notification-email';

const JOB_NAME = 'notification-emails';
/** Rows handled per run; the next run picks up the rest. */
const BATCH_SIZE = 50;
/** A claim older than this belongs to a crashed instance and can be taken over. */
const STALE_CLAIM_MS = 5 * 60_000;
const MAX_DETAIL_LENGTH = 500;

export interface DispatchSummary {
  sent: number;
  skipped: number;
  retried: number;
  failed: number;
}

/**
 * Worker of the email outbox (ADR 0011). Every run it expires what is too old to matter,
 * claims due deliveries one by one (safe with several API instances), and sends them.
 * A failure is retried with backoff and never touches the notification itself.
 */
@Injectable()
export class NotificationEmailDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(NotificationEmailDispatcher.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly config: AppConfigService,
    private readonly registry: SchedulerRegistry,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport | null,
  ) {}

  onApplicationBootstrap(): void {
    const seconds = this.config.get('EMAIL_DISPATCH_INTERVAL_SECONDS');
    if (!this.transport || seconds === 0) return;
    const interval = setInterval(() => void this.run(), seconds * 1000);
    this.registry.addInterval(JOB_NAME, interval);
    this.logger.log(`Sending notification emails every ${seconds}s`);
  }

  onModuleDestroy(): void {
    if (this.registry.doesExist('interval', JOB_NAME)) this.registry.deleteInterval(JOB_NAME);
  }

  /** One run, never overlapping the previous one in this instance. */
  async run(now = new Date()): Promise<DispatchSummary | null> {
    if (this.running || !this.transport) return null;
    this.running = true;
    try {
      return await this.dispatch(this.transport, now);
    } catch (err) {
      this.logger.error({ err }, 'Email dispatch failed');
      return null;
    } finally {
      this.running = false;
    }
  }

  private async dispatch(transport: MailTransport, now: Date): Promise<DispatchSummary> {
    const summary: DispatchSummary = { sent: 0, skipped: 0, retried: 0, failed: 0 };
    const expired = await this.prisma.emailDelivery.updateMany({
      where: { status: 'PENDING', createdAt: { lt: new Date(now.getTime() - EMAIL_MAX_AGE_MS) } },
      data: { status: 'SKIPPED', detail: 'Too old to be useful', lockedAt: null },
    });
    summary.skipped += expired.count;

    const staleClaim = new Date(now.getTime() - STALE_CLAIM_MS);
    const claimable = {
      status: 'PENDING' as const,
      nextAttemptAt: { lte: now },
      OR: [{ lockedAt: null }, { lockedAt: { lt: staleClaim } }],
    };
    const due = await this.prisma.emailDelivery.findMany({
      where: claimable,
      orderBy: { nextAttemptAt: 'asc' },
      take: BATCH_SIZE,
      select: { id: true },
    });
    if (due.length === 0) return summary;
    const context = {
      appUrl: this.config.get('APP_PUBLIC_URL') ?? null,
      timezone: await this.settings.getTimezone(),
    };

    for (const { id } of due) {
      // The claim is the lock: only the instance whose update matched sends this email.
      const claimed = await this.prisma.emailDelivery.updateMany({
        where: { id, ...claimable },
        data: { lockedAt: now },
      });
      if (claimed.count === 0) continue;
      const delivery = await this.prisma.emailDelivery.findUniqueOrThrow({
        where: { id },
        include: {
          notification: {
            include: {
              user: { select: { email: true, isActive: true, emailNotifications: true } },
            },
          },
        },
      });
      const { notification } = delivery;
      const { user } = notification;

      const skip = notification.readAt
        ? 'Read in the app before it was sent'
        : !user.isActive
          ? 'User is inactive'
          : !user.emailNotifications
            ? 'User turned email notifications off'
            : null;
      if (skip) {
        await this.finish(id, { status: 'SKIPPED', detail: skip });
        summary.skipped++;
        continue;
      }

      const attempts = delivery.attempts + 1;
      try {
        const email = renderNotificationEmail(toPayload(notification), context);
        await transport.send({ to: user.email, ...email });
        await this.finish(id, { status: 'SENT', attempts, sentAt: now, detail: null });
        summary.sent++;
      } catch (err) {
        const detail = describe(err);
        const retryAt = nextAttemptAfter(attempts, now);
        if (retryAt) {
          await this.finish(id, { attempts, nextAttemptAt: retryAt, detail });
          summary.retried++;
        } else {
          await this.finish(id, { status: 'FAILED', attempts, detail });
          summary.failed++;
        }
        this.logger.warn({ deliveryId: id, attempts, detail }, 'Notification email not sent');
      }
    }
    return summary;
  }

  private finish(
    id: string,
    data: {
      status?: 'SENT' | 'SKIPPED' | 'FAILED';
      attempts?: number;
      nextAttemptAt?: Date;
      sentAt?: Date;
      detail: string | null;
    },
  ) {
    return this.prisma.emailDelivery.update({ where: { id }, data: { ...data, lockedAt: null } });
  }
}

/** The server's answer, short; SMTP errors carry no credentials, but keep it bounded. */
function describe(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH)}…` : text;
}
