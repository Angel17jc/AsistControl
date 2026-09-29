import type { NestExpressApplication } from '@nestjs/platform-express';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppConfigService } from '../src/config/app-config.service';
import { MAIL_TRANSPORT, type MailMessage, type MailTransport } from '../src/mail/mail-transport';
import { NotificationEmailDispatcher } from '../src/notifications/email/notification-email.dispatcher';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/settings/settings.service';
import { WORK_DATE, bearer, createApp, createFixture, type Fixture, login } from './utils';

/** Stands in for the SMTP server: records what was sent and can refuse on demand. */
class MemoryMailTransport implements MailTransport {
  readonly sent: MailMessage[] = [];
  failures = 0;

  async send(message: MailMessage): Promise<void> {
    if (this.failures > 0) {
      this.failures--;
      throw new Error('421 4.3.2 Service not available, closing transmission channel');
    }
    this.sent.push(message);
  }
}

/**
 * The email channel end to end (ADR 0011): notifications queue an email with them, a worker
 * sends it, retries with backoff, gives up, and skips what no longer needs sending.
 * Other suites share the database, so assertions are about this suite's supervisor.
 */
describe('Notification emails (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let fx: Fixture;
  let employee: string;
  let supervisor: string;
  let supervisorId: string;
  const mail = new MemoryMailTransport();
  const http = () => request(app.getHttpServer());
  const dispatcher = () => app.get(NotificationEmailDispatcher);
  const minutesFrom = (from: Date, minutes: number) => new Date(from.getTime() + minutes * 60_000);

  let day = 0;
  /** A new request from the employee: its reviewers, the supervisor among them, get notified. */
  const requestLeave = async () => {
    day++;
    const res = await http()
      .post('/api/leave-requests')
      .set(bearer(employee))
      .send({
        type: 'PERSONAL',
        startsAt: `2027-03-${String(day).padStart(2, '0')}T08:00:00-05:00`,
        endsAt: `2027-03-${String(day).padStart(2, '0')}T10:00:00-05:00`,
        reason: 'Trámite personal',
      })
      .expect(201);
    return prisma.emailDelivery.findFirstOrThrow({
      where: { notification: { userId: supervisorId, entityId: res.body.id } },
      include: { notification: true },
    });
  };
  const deliveryOf = (id: string) => prisma.emailDelivery.findUniqueOrThrow({ where: { id } });
  const mailsTo = (email: string) => mail.sent.filter((m) => m.to === email);

  beforeAll(async () => {
    app = await createApp((builder) => builder.overrideProvider(MAIL_TRANSPORT).useValue(mail));
    prisma = new PrismaClient();
    fx = await createFixture(prisma, 'eml');
    employee = await login(app, fx.emails.employee);
    supervisor = await login(app, fx.emails.supervisor);
    supervisorId = (await prisma.user.findUniqueOrThrow({ where: { email: fx.emails.supervisor } }))
      .id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('queues an email with every notification and sends it once', async () => {
    const delivery = await requestLeave();
    expect(delivery).toMatchObject({ status: 'PENDING', attempts: 0 });

    await dispatcher().run(new Date());
    await dispatcher().run(new Date());

    expect(await deliveryOf(delivery.id)).toMatchObject({ status: 'SENT', attempts: 1 });
    const sent = mailsTo(fx.emails.supervisor);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toMatch(/^Solicitud por revisar: /);
    expect(sent[0]!.text).toContain('Permiso personal, del 1 mar 2027, 08:00');
  });

  it('skips a notification already read in the app', async () => {
    const delivery = await requestLeave();
    await http()
      .post(`/api/notifications/${delivery.notificationId}/read`)
      .set(bearer(supervisor))
      .expect(204);

    await dispatcher().run(new Date());
    expect(await deliveryOf(delivery.id)).toMatchObject({
      status: 'SKIPPED',
      detail: 'Read in the app before it was sent',
    });
  });

  it('lets people turn email off, even for emails already queued', async () => {
    expect(
      (await http().get('/api/notifications/preferences').set(bearer(supervisor))).body,
    ).toMatchObject({ emailNotifications: true, emailAvailable: true });
    const delivery = await requestLeave();
    const off = await http()
      .patch('/api/notifications/preferences')
      .set(bearer(supervisor))
      .send({ emailNotifications: false })
      .expect(200);
    expect(off.body).toMatchObject({ emailNotifications: false, emailAvailable: true });

    await dispatcher().run(new Date());
    expect(await deliveryOf(delivery.id)).toMatchObject({
      status: 'SKIPPED',
      detail: 'User turned email notifications off',
    });

    await http()
      .patch('/api/notifications/preferences')
      .set(bearer(supervisor))
      .send({ emailNotifications: true })
      .expect(200);
    await http()
      .patch('/api/notifications/preferences')
      .set(bearer(supervisor))
      .send({ emailNotifications: 'yes' })
      .expect(400);
  });

  describe('by type', () => {
    const preferences = (body?: object) =>
      body
        ? http().patch('/api/notifications/preferences').set(bearer(supervisor)).send(body)
        : http().get('/api/notifications/preferences').set(bearer(supervisor));

    it('offers only the types the role can receive, all on by default', async () => {
      // A supervisor reviews and requests leave, but never hears about devices.
      expect((await preferences().expect(200)).body.emailTypes).toEqual([
        { type: 'LEAVE_REQUESTED', enabled: true },
        { type: 'LEAVE_REVIEWED', enabled: true },
        { type: 'VACATION_EXPIRING', enabled: true },
      ]);
    });

    it('skips a muted type by email; the bell still gets it', async () => {
      const muted = await preferences({ mutedTypes: ['LEAVE_REQUESTED'] }).expect(200);
      expect(muted.body.emailTypes).toContainEqual({ type: 'LEAVE_REQUESTED', enabled: false });
      expect(muted.body.emailNotifications).toBe(true);

      const delivery = await requestLeave();
      await dispatcher().run(new Date());
      expect(await deliveryOf(delivery.id)).toMatchObject({
        status: 'SKIPPED',
        detail: 'User turned this type off by email',
      });
      expect(delivery.notification.userId).toBe(supervisorId);

      await preferences({ mutedTypes: [] }).expect(200);
      const next = await requestLeave();
      await dispatcher().run(new Date());
      expect((await deliveryOf(next.id)).status).toBe('SENT');
    });

    it('rejects unknown types, empty bodies and a bad switch next to a good list', async () => {
      await preferences({ mutedTypes: ['NOT_A_TYPE'] }).expect(400);
      await preferences({ mutedTypes: 'LEAVE_REQUESTED' }).expect(400);
      await preferences({}).expect(400);
      await preferences({ emailNotifications: 'yes', mutedTypes: [] }).expect(400);
    });
  });

  it('retries a refused email with backoff, then gives up', async () => {
    const delivery = await requestLeave();
    const start = new Date();
    mail.failures = 1_000;

    await dispatcher().run(start);
    const first = await deliveryOf(delivery.id);
    expect(first).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(first.detail).toMatch(/^421 /);
    expect(first.nextAttemptAt).toEqual(minutesFrom(start, 1));

    // Not due yet: nothing happens.
    await dispatcher().run(minutesFrom(start, 0.5));
    expect((await deliveryOf(delivery.id)).attempts).toBe(1);

    // 1, 5, 15 and 60 minutes after each failure; the fifth failure is final.
    let at = start;
    for (const wait of [1, 5, 15, 60]) {
      at = minutesFrom(at, wait);
      await dispatcher().run(at);
    }
    mail.failures = 0;
    expect(await deliveryOf(delivery.id)).toMatchObject({ status: 'FAILED', attempts: 5 });

    await dispatcher().run(minutesFrom(at, 120));
    expect((await deliveryOf(delivery.id)).status).toBe('FAILED');
  });

  it('drops what is too old to be worth an email', async () => {
    const delivery = await requestLeave();
    await dispatcher().run(minutesFrom(delivery.createdAt, 25 * 60));
    expect(await deliveryOf(delivery.id)).toMatchObject({
      status: 'SKIPPED',
      detail: 'Too old to be useful',
    });
  });

  it('sends each email once even with two instances running at the same time', async () => {
    const delivery = await requestLeave();
    const before = mailsTo(fx.emails.supervisor).length;
    // A second API instance: its own dispatcher, the same database and mail server.
    const other = new NotificationEmailDispatcher(
      app.get(PrismaService),
      app.get(SettingsService),
      app.get(AppConfigService),
      app.get(SchedulerRegistry),
      mail,
    );
    const now = new Date();
    await Promise.all([dispatcher().run(now), other.run(now)]);

    expect(await deliveryOf(delivery.id)).toMatchObject({ status: 'SENT', attempts: 1 });
    expect(mailsTo(fx.emails.supervisor).length - before).toBe(1);
  });

  it('never blocks the action that caused the notification', async () => {
    mail.failures = 1_000;
    // The request itself succeeds; the email is someone else's problem, later.
    await http()
      .post('/api/leave-requests')
      .set(bearer(employee))
      .send({
        type: 'MEDICAL',
        startsAt: `${WORK_DATE}T08:00:00-05:00`,
        endsAt: `${WORK_DATE}T09:00:00-05:00`,
        reason: 'Control médico',
      })
      .expect(201);
    mail.failures = 0;
  });
});
