import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { addDays, todayIn, toDbDate } from '../common/utils/date-only';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { VacationsService } from './vacations.service';

/** How far ahead people hear that some of their vacation days are about to expire. */
export const EXPIRY_NOTICE_DAYS = 30;

/**
 * Once a day, warns the people whose contract makes vacation days expire and who will lose
 * some within EXPIRY_NOTICE_DAYS unless they use them (ADR 0009). The balance computes what
 * would expire, already counting the vacations approved before that date; a person hears
 * about each expiry date once. Only people with an account can be told.
 */
@Injectable()
export class VacationExpiryNotices {
  private readonly logger = new Logger(VacationExpiryNotices.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly vacations: VacationsService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_7AM, { name: 'vacation-expiry-notices' })
  async run(now = new Date()): Promise<number> {
    const timezone = await this.settings.getTimezone();
    const today = todayIn(timezone, now);
    const horizon = addDays(today, EXPIRY_NOTICE_DAYS);
    const employees = await this.prisma.employee.findMany({
      where: {
        deletedAt: null,
        OR: [{ terminatedAt: null }, { terminatedAt: { gt: toDbDate(today) } }],
        contractType: { vacationExpiryMonths: { not: null } },
        user: { isActive: true },
      },
      select: { id: true, firstName: true, lastName: true, user: { select: { id: true } } },
    });

    let sent = 0;
    for (const employee of employees) {
      if (!employee.user) continue;
      try {
        const { nextExpiry } = await this.vacations.balanceAt(employee.id, today, timezone);
        if (!nextExpiry || nextExpiry.date > horizon) continue;
        const notified = await this.notifications.vacationExpiring({
          employeeId: employee.id,
          employeeName: `${employee.firstName} ${employee.lastName}`,
          userId: employee.user.id,
          days: nextExpiry.days,
          expiresOn: nextExpiry.date,
        });
        if (notified) sent++;
      } catch (err) {
        // One broken balance must not keep everyone else from being told.
        this.logger.warn({ err, employeeId: employee.id }, 'Vacation expiry check failed');
      }
    }
    if (sent > 0) this.logger.log(`Warned ${sent} people about expiring vacation days`);
    return sent;
  }
}
