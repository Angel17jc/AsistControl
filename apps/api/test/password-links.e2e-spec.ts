import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppConfigService } from '../src/config/app-config.service';
import { LinkMailer } from '../src/mail/link-mailer';
import { MAIL_TRANSPORT, type MailMessage, type MailTransport } from '../src/mail/mail-transport';
import { PASSWORD, bearer, createApp, createFixture, type Fixture, login } from './utils';

class MemoryMailTransport implements MailTransport {
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}

const APP_URL = 'https://asistencia.empresa.com';
const NEW_PASSWORD = 'Melanie2026Propia';
const LINK = /https:\/\/asistencia\.empresa\.com\/restablecer#([A-Za-z0-9_-]{43})/;

/**
 * "Olvidé mi contraseña" end to end (ADR 0016): the answer never reveals whether an address
 * has an account; the emailed link works once, for its own account, and ends every session.
 */
describe('Password links (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let fx: Fixture;
  const mail = new MemoryMailTransport();
  const http = () => request(app.getHttpServer());
  const mailsTo = (email: string) => mail.sent.filter((m) => m.to === email);

  /** The email goes out after the answer: wait for it, briefly. */
  async function nextMail(email: string, count: number): Promise<MailMessage> {
    for (let i = 0; i < 50 && mailsTo(email).length < count; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const all = mailsTo(email);
    expect(all).toHaveLength(count);
    return all[count - 1]!;
  }
  const tokenOf = (message: MailMessage) => LINK.exec(message.text)![1]!;
  const forgot = (email: string) =>
    http().post('/api/auth/forgot-password').send({ email }).expect(202);
  /** Lets the next reset email through: one per account per minute otherwise. */
  const skipCooldown = (email: string) =>
    prisma.passwordLink.updateMany({
      where: { user: { email } },
      data: { createdAt: new Date(Date.now() - 5 * 60_000) },
    });

  beforeAll(async () => {
    app = await createApp((builder) =>
      builder
        .overrideProvider(MAIL_TRANSPORT)
        .useValue(mail)
        .overrideProvider(LinkMailer)
        .useFactory({
          inject: [AppConfigService],
          factory: (config: AppConfigService) =>
            new (class extends LinkMailer {
              override get appUrl() {
                return APP_URL;
              }
            })(config, mail),
        }),
    );
    prisma = new PrismaClient();
    fx = await createFixture(prisma, 'pwl');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('tells the sign-in page that links are available', async () => {
    const res = await http().get('/api/auth/options').expect(200);
    expect(res.body).toEqual({ passwordLinks: true });
  });

  it('emails a link that sets a new password once and ends every session', async () => {
    const email = fx.emails.employee;
    await login(app, email);
    const openBefore = await prisma.session.findMany({
      where: { user: { email }, revokedAt: null },
      select: { id: true },
    });
    expect(openBefore.length).toBeGreaterThan(0);

    const res = await forgot(`  ${email.toUpperCase()} `);
    expect(res.body).toEqual({});
    const message = await nextMail(email, 1);
    expect(message.subject).toBe('Restablecer su contraseña de AsistControl');
    expect(message.text).toContain(`la cuenta ${email}`);
    expect(message.html).toContain(`href="${APP_URL}/restablecer#`);
    const token = tokenOf(message);

    const info = await http().post('/api/auth/password-link').send({ token }).expect(200);
    expect(info.body).toMatchObject({ email, purpose: 'RESET' });
    const minutesLeft = (Date.parse(info.body.expiresAt) - Date.now()) / 60_000;
    expect(minutesLeft).toBeGreaterThan(29);
    expect(minutesLeft).toBeLessThanOrEqual(30);

    const weak = await http()
      .post('/api/auth/reset-password')
      .send({ token, newPassword: 'corta' })
      .expect(400);
    expect(weak.body.code).toBe('VALIDATION_FAILED');

    await http()
      .post('/api/auth/reset-password')
      .send({ token, newPassword: NEW_PASSWORD })
      .expect(204);
    await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(401);
    await http().post('/api/auth/login').send({ email, password: NEW_PASSWORD }).expect(200);
    const stillOpen = await prisma.session.count({
      where: { id: { in: openBefore.map((s) => s.id) }, revokedAt: null },
    });
    expect(stillOpen).toBe(0);

    const again = await http()
      .post('/api/auth/reset-password')
      .send({ token, newPassword: 'OtraClave2026x' })
      .expect(400);
    expect(again.body.code).toBe('PASSWORD_LINK_INVALID');
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'auth.password_reset', entity: 'User', actor: { email } },
    });
    expect(audit).not.toBeNull();
  });

  it('answers the same for an unknown address and sends nothing', async () => {
    const before = mail.sent.length;
    const res = await forgot('nadie-pwl@e2e.local');
    expect(res.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mail.sent).toHaveLength(before);
    const audit = await prisma.auditLog.findFirst({
      where: {
        action: 'auth.password_reset_requested',
        metadata: { path: ['email'], equals: 'nadie-pwl@e2e.local' },
      },
    });
    expect(audit?.metadata).toMatchObject({ sent: false, reason: 'unknown_user' });
  });

  it('sends one email per account per minute, however many times it is asked', async () => {
    const email = fx.emails.hr;
    await forgot(email);
    await forgot(email);
    await nextMail(email, 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mailsTo(email)).toHaveLength(1);
  });

  it('keeps only the newest link working', async () => {
    const email = fx.emails.supervisor;
    await forgot(email);
    const first = tokenOf(await nextMail(email, 1));
    await skipCooldown(email);
    await forgot(email);
    const second = tokenOf(await nextMail(email, 2));

    const old = await http().post('/api/auth/password-link').send({ token: first }).expect(400);
    expect(old.body.code).toBe('PASSWORD_LINK_INVALID');
    await http().post('/api/auth/password-link').send({ token: second }).expect(200);
  });

  it('refuses an expired link and says it expired', async () => {
    const email = fx.emails.supervisor;
    await skipCooldown(email);
    const before = mailsTo(email).length;
    await forgot(email);
    const token = tokenOf(await nextMail(email, before + 1));
    await prisma.passwordLink.updateMany({
      where: { user: { email }, usedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await http().post('/api/auth/password-link').send({ token }).expect(400);
    expect(res.body).toMatchObject({ code: 'PASSWORD_LINK_EXPIRED', params: { purpose: 'RESET' } });
  });

  it('a password changed another way kills pending links', async () => {
    const email = fx.emails.admin;
    await forgot(email);
    const token = tokenOf(await nextMail(email, 1));
    const admin = await login(app, email);
    await http()
      .post('/api/auth/change-password')
      .set(bearer(admin))
      .send({ currentPassword: PASSWORD, newPassword: 'AdminNueva2026' })
      .expect(204);
    const res = await http().post('/api/auth/password-link').send({ token }).expect(400);
    expect(res.body.code).toBe('PASSWORD_LINK_INVALID');
  });

  it('sends nothing to a disabled account, and its links stop working', async () => {
    const email = fx.emails.employee;
    await skipCooldown(email);
    const sentBefore = mailsTo(email).length;
    await forgot(email);
    const token = tokenOf(await nextMail(email, sentBefore + 1));
    await prisma.user.update({ where: { email }, data: { isActive: false } });
    const res = await http().post('/api/auth/password-link').send({ token }).expect(400);
    expect(res.body.code).toBe('PASSWORD_LINK_INVALID');

    await skipCooldown(email);
    const before = mailsTo(email).length;
    await forgot(email);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mailsTo(email)).toHaveLength(before);
    await prisma.user.update({ where: { email }, data: { isActive: true } });
  });

  it('refuses a token that is not one', async () => {
    const res = await http().post('/api/auth/password-link').send({ token: 'abc' }).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});
