import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { MAIL_TRANSPORT, type MailMessage, type MailTransport } from './mail-transport';

/**
 * How password links reach people (ADR 0016):
 * - `send`: by email (SMTP_URL set, e.g. Amazon SES).
 * - `log`: written to the server log instead. Only outside production, so the flow can be
 *   tried before email is configured; a production log must never hold a live link.
 * - `off`: no email and production, or no APP_PUBLIC_URL to build the link from. The sign-in
 *   page then sends people to an administrator.
 */
export type LinkDelivery = 'send' | 'log' | 'off';

/** Waits between attempts; a link that fails three times is asked for again. */
const RETRY_DELAYS_MS = [2_000, 10_000];

@Injectable()
export class LinkMailer {
  private readonly logger = new Logger(LinkMailer.name);

  constructor(
    private readonly config: AppConfigService,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport | null,
  ) {}

  get delivery(): LinkDelivery {
    if (!this.appUrl) return 'off';
    if (this.transport) return 'send';
    return this.config.isProduction ? 'off' : 'log';
  }

  /** Where links point: the web app's public address. */
  get appUrl(): string | null {
    return this.config.get('APP_PUBLIC_URL') ?? null;
  }

  /**
   * Sends without making the caller wait: the request answers at once, and just as fast
   * whether or not an email went out (nobody learns which addresses have an account).
   * Returns the attempt so tests can await it.
   */
  dispatch(message: MailMessage, label: string): Promise<void> {
    return this.deliver(message, label).catch((err: unknown) =>
      this.logger.error({ err, label }, 'Password link email not sent'),
    );
  }

  private async deliver(message: MailMessage, label: string): Promise<void> {
    const delivery = this.delivery;
    if (delivery === 'off') return;
    if (delivery === 'log' || !this.transport) {
      this.logger.warn(
        { label, to: message.to, subject: message.subject, text: message.text },
        'Email not sent (no SMTP_URL configured); this is what it says',
      );
      return;
    }
    for (let attempt = 0; ; attempt++) {
      try {
        await this.transport.send(message);
        return;
      } catch (err) {
        const wait = RETRY_DELAYS_MS[attempt];
        if (wait === undefined) throw err;
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  }
}
