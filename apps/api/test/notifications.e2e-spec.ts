import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { type NotificationType, PrismaClient } from '@prisma/client';
import { type AppNotification, REALTIME_EVENTS, REALTIME_NAMESPACE } from '@asistcontrol/shared';
import { type Socket, io } from 'socket.io-client';
import request from 'supertest';
import { NotificationsService } from '../src/notifications/notifications.service';
import { WORK_DATE, bearer, createApp, createFixture, type Fixture, login } from './utils';

/**
 * Notifications reach the people who must act, once per incident, only them, and live.
 * Other suites share the database, so every assertion is about this suite's own users.
 */
describe('Notifications (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let fx: Fixture;
  /** A second organization slice: its supervisor must never hear about ours. */
  let other: Fixture;
  const tokens = {} as Record<'admin' | 'hr' | 'supervisor' | 'employee', string>;
  const ids = {} as Record<'admin' | 'hr' | 'supervisor' | 'employee' | 'otherSupervisor', string>;
  const http = () => request(app.getHttpServer());

  const count = (userId: string, type: NotificationType, entityId: string) =>
    prisma.notification.count({ where: { userId, type, entityId } });

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    prisma = new PrismaClient();
    fx = await createFixture(prisma, 'ntf');
    other = await createFixture(prisma, 'nto');
    for (const role of ['admin', 'hr', 'supervisor', 'employee'] as const) {
      tokens[role] = await login(app, fx.emails[role]);
      ids[role] = (await prisma.user.findUniqueOrThrow({ where: { email: fx.emails[role] } })).id;
    }
    ids.otherSupervisor = (
      await prisma.user.findUniqueOrThrow({ where: { email: other.emails.supervisor } })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('a device outage', () => {
    let deviceId: string;
    const sync = () =>
      http().post(`/api/devices/${deviceId}/sync`).set(bearer(tokens.admin)).expect(200);
    const faults = (body: object) =>
      http()
        .post(`/api/devices/${deviceId}/simulate/faults`)
        .set(bearer(tokens.admin))
        .send(body)
        .expect(201);

    beforeAll(async () => {
      const created = await http()
        .post('/api/devices')
        .set(bearer(tokens.admin))
        .send({
          name: 'Terminal vigilado',
          driver: 'MOCK',
          manufacturer: 'AsistControl',
          model: 'AC-SIM-100',
          host: '10.55.0.1',
          port: 4370,
        })
        .expect(201);
      deviceId = created.body.id;
      await sync(); // seen online at least once
    });

    it('is reported once per outage, to those who can act on devices', async () => {
      await faults({ online: false });
      await sync();
      await sync(); // still down: the scheduler would keep failing every few minutes

      expect(await count(ids.admin, 'DEVICE_DOWN', deviceId)).toBe(1);
      for (const user of [ids.hr, ids.supervisor, ids.employee]) {
        expect(await count(user, 'DEVICE_DOWN', deviceId)).toBe(0);
      }

      const [down] = (
        await http().get('/api/notifications?unread=true').set(bearer(tokens.admin)).expect(200)
      ).body.data.filter((n: AppNotification) => n.entityId === deviceId);
      expect(down).toMatchObject({
        type: 'DEVICE_DOWN',
        entity: 'Device',
        readAt: null,
        data: { deviceName: 'Terminal vigilado', status: 'OFFLINE' },
      });
      expect(down.data.error).toMatch(/^CONNECTION_FAILED/);
    });

    it('announces the recovery once, and a new outage is a new incident', async () => {
      await faults({ online: true });
      await sync();
      await sync();
      expect(await count(ids.admin, 'DEVICE_RECOVERED', deviceId)).toBe(1);

      await faults({ online: false });
      await sync();
      expect(await count(ids.admin, 'DEVICE_DOWN', deviceId)).toBe(2);
      await faults({ online: true });
      await sync();
    });

    it('stays quiet about a terminal that was never reached', async () => {
      const created = await http()
        .post('/api/devices')
        .set(bearer(tokens.admin))
        .send({
          name: 'Terminal sin instalar',
          driver: 'MOCK',
          manufacturer: 'AsistControl',
          model: 'AC-SIM-100',
          host: '10.55.0.2',
          port: 4370,
        })
        .expect(201);
      const id = created.body.id as string;
      await http()
        .post(`/api/devices/${id}/simulate/faults`)
        .set(bearer(tokens.admin))
        .send({ online: false })
        .expect(201);
      await http().post(`/api/devices/${id}/sync`).set(bearer(tokens.admin)).expect(200);

      expect(await prisma.notification.count({ where: { entityId: id } })).toBe(0);
    });
  });

  describe('a leave request', () => {
    let requestId: string;

    it('goes to its reviewers: HR, admins and the direct supervisor only', async () => {
      const res = await http()
        .post('/api/leave-requests')
        .set(bearer(tokens.employee))
        .send({
          type: 'PERSONAL',
          startsAt: `${WORK_DATE}T14:00:00-05:00`,
          endsAt: `${WORK_DATE}T17:00:00-05:00`,
          reason: 'Cita médica',
        })
        .expect(201);
      requestId = res.body.id;

      for (const reviewer of [ids.admin, ids.hr, ids.supervisor]) {
        expect(await count(reviewer, 'LEAVE_REQUESTED', requestId)).toBe(1);
      }
      // Not the requester, and not a supervisor of another team.
      expect(await count(ids.employee, 'LEAVE_REQUESTED', requestId)).toBe(0);
      expect(await count(ids.otherSupervisor, 'LEAVE_REQUESTED', requestId)).toBe(0);

      const notification = await prisma.notification.findFirstOrThrow({
        where: { userId: ids.supervisor, entityId: requestId },
      });
      expect(notification.data).toMatchObject({
        employeeName: 'Name2 ntfLast2',
        leaveType: 'PERSONAL',
      });
    });

    it('tells the employee the decision, and not the reviewer', async () => {
      await http()
        .post(`/api/leave-requests/${requestId}/review`)
        .set(bearer(tokens.supervisor))
        .send({ decision: 'REJECTED', note: 'Coincide con el inventario' })
        .expect(201);

      const decided = await prisma.notification.findFirstOrThrow({
        where: { userId: ids.employee, type: 'LEAVE_REVIEWED', entityId: requestId },
      });
      expect(decided.data).toMatchObject({
        decision: 'REJECTED',
        note: 'Coincide con el inventario',
      });
      expect(await count(ids.supervisor, 'LEAVE_REVIEWED', requestId)).toBe(0);
    });
  });

  describe('reading them', () => {
    it('lists and counts only my own', async () => {
      const mine = (
        await http().get('/api/notifications?pageSize=100').set(bearer(tokens.employee))
      ).body;
      expect(mine.data.length).toBeGreaterThan(0);
      expect(
        await prisma.notification.count({
          where: {
            id: { in: mine.data.map((n: AppNotification) => n.id) },
            userId: { not: ids.employee },
          },
        }),
      ).toBe(0);

      const unread = (
        await http().get('/api/notifications/unread-count').set(bearer(tokens.employee))
      ).body.count;
      expect(unread).toBe(
        await prisma.notification.count({ where: { userId: ids.employee, readAt: null } }),
      );
    });

    it('marks one as read, idempotently, and never someone else’s', async () => {
      const own = await prisma.notification.findFirstOrThrow({ where: { userId: ids.admin } });
      await http().post(`/api/notifications/${own.id}/read`).set(bearer(tokens.admin)).expect(204);
      const firstRead = (await prisma.notification.findUniqueOrThrow({ where: { id: own.id } }))
        .readAt;
      expect(firstRead).not.toBeNull();
      await http().post(`/api/notifications/${own.id}/read`).set(bearer(tokens.admin)).expect(204);
      expect(
        (await prisma.notification.findUniqueOrThrow({ where: { id: own.id } })).readAt,
      ).toEqual(firstRead);

      // Someone else's looks exactly like one that does not exist.
      const foreign = await prisma.notification.findFirstOrThrow({ where: { userId: ids.hr } });
      await http()
        .post(`/api/notifications/${foreign.id}/read`)
        .set(bearer(tokens.admin))
        .expect(404);
      expect(
        (await prisma.notification.findUniqueOrThrow({ where: { id: foreign.id } })).readAt,
      ).toBeNull();
    });

    it('marks all mine as read', async () => {
      const res = await http()
        .post('/api/notifications/read-all')
        .set(bearer(tokens.supervisor))
        .expect(200);
      expect(res.body.updated).toBeGreaterThan(0);
      expect(
        (await http().get('/api/notifications/unread-count').set(bearer(tokens.supervisor))).body,
      ).toEqual({ count: 0 });
    });

    it('forgets notifications past retention', async () => {
      const old = await prisma.notification.create({
        data: {
          userId: ids.hr,
          type: 'DEVICE_RECOVERED',
          data: { deviceName: 'Antiguo' },
          createdAt: new Date(Date.now() - 91 * 86_400_000),
        },
      });
      await app.get(NotificationsService).purgeExpired();
      expect(await prisma.notification.findUnique({ where: { id: old.id } })).toBeNull();
    });
  });

  describe('live delivery', () => {
    const sockets: Socket[] = [];
    const connect = async (token: string) => {
      const { port } = app.getHttpServer().address() as AddressInfo;
      const socket = io(`http://127.0.0.1:${port}${REALTIME_NAMESPACE}`, {
        auth: { token },
        transports: ['websocket'],
      });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
      });
      return socket;
    };

    afterAll(() => sockets.forEach((s) => s.disconnect()));

    it('pushes a notification to its recipient only', async () => {
      const supervisor = await connect(tokens.supervisor);
      const teammate = await connect(await login(app, other.emails.supervisor));
      const leaked: AppNotification[] = [];
      teammate.on(REALTIME_EVENTS.NOTIFICATION_CREATED, (n: AppNotification) => leaked.push(n));

      const received = new Promise<AppNotification>((resolve) =>
        supervisor.once(REALTIME_EVENTS.NOTIFICATION_CREATED, resolve),
      );
      const res = await http()
        .post('/api/leave-requests')
        .set(bearer(tokens.employee))
        .send({
          type: 'MEDICAL',
          startsAt: `${WORK_DATE}T08:00:00-05:00`,
          endsAt: `${WORK_DATE}T10:00:00-05:00`,
          reason: 'Control médico',
        })
        .expect(201);

      const notification = await received;
      expect(notification).toMatchObject({
        type: 'LEAVE_REQUESTED',
        entityId: res.body.id,
        readAt: null,
        data: { leaveType: 'MEDICAL' },
      });
      await new Promise((r) => setTimeout(r, 300));
      expect(leaked).toHaveLength(0);
    });
  });
});
