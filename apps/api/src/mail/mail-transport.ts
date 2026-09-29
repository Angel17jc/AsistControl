import { type Transporter, createTransport } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Optional HTML alternative; clients that cannot show it read `text`. */
  html?: string;
}

/**
 * Port of the email channel. Sending either resolves (the server accepted the message) or
 * throws; retries are the caller's business. Implementations: SMTP here, an in-memory one
 * in the e2e suite.
 */
export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}

/** Injection token. Its value is null when email is off (no SMTP_URL). */
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

export interface SmtpSettings {
  url: string;
  from: string;
  /** Refuse to send over a connection that did not upgrade to TLS (production). */
  requireTls: boolean;
}

/**
 * SMTP through nodemailer. The URL is parsed here rather than handed over, so TLS and
 * timeouts are explicit: a slow mail server must never stall the worker.
 */
export class SmtpMailTransport implements MailTransport {
  private readonly transporter: Transporter;

  constructor(private readonly settings: SmtpSettings) {
    this.transporter = createTransport(smtpOptions(settings));
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.settings.from, ...message });
  }
}

/** Exported for tests: what nodemailer receives for a given configuration. */
export function smtpOptions({ url, requireTls }: SmtpSettings) {
  const parsed = new URL(url);
  const implicitTls = parsed.protocol === 'smtps:';
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : implicitTls ? 465 : 587,
    secure: implicitTls,
    requireTLS: !implicitTls && requireTls,
    auth: parsed.username
      ? {
          user: decodeURIComponent(parsed.username),
          pass: decodeURIComponent(parsed.password),
        }
      : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
}
