import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import { REALTIME_NAMESPACE } from '@asistcontrol/shared';
import { io } from 'socket.io-client';
import request from 'supertest';
import { hashPassword } from '../src/auth/password-hashing';
import { PASSWORD, bearer, createApp, eventually } from './utils';

const NEW_PASSWORD = 'Mi-Clave-Nueva-2026';

/**
 * Changing your own password: it takes the current one, keeps the session making the change
 * and ends every other one, so whoever knew the old password is out.
 */
describe('Change own password (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  const http = () => request(app.getHttpServer());
  const signIn = (email: string, password = PASSWORD) =>
    http().post('/api/auth/login').send({ email, password });
  const change = (token: string, body: object) =>
    http().post('/api/auth/change-password').set(bearer(token)).send(body);
  /** "name=value" of the refresh cookie a response sets. */
  const refreshCookieOf = (res: request.Response) =>
    String(res.headers['set-cookie']).split(';')[0]!;
  const refresh = (cookie: string) => http().post('/api/auth/refresh').set('Cookie', cookie);

  /** A fresh account per test, so no test depends on another's password. */
  let seq = 0;
  async function account() {
    const email = `cpw-${++seq}@e2e.local`;
    const user = await prisma.user.create({
      data: { email, role: 'HR', passwordHash: await hashPassword(PASSWORD) },
    });
    const res = await signIn(email).expect(200);
    return {
      id: user.id,
      email,
      token: res.body.accessToken as string,
      cookie: refreshCookieOf(res),
    };
  }

  beforeAll(async () => {
    app = await createApp();
    // A real port: the realtime gateway is part of what a pending password change closes.
    await app.listen(0, '127.0.0.1');
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('replaces the password, keeps this session and ends the others', async () => {
    const me = await account();
    const otherDevice = refreshCookieOf(await signIn(me.email).expect(200));

    await change(me.token, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(204);

    await signIn(me.email).expect(401);
    await signIn(me.email, NEW_PASSWORD).expect(200);
    await refresh(me.cookie).expect(200);
    await refresh(otherDevice).expect(401);

    const audit = await eventually(
      () =>
        prisma.auditLog.findFirst({ where: { entityId: me.id, action: 'auth.password_changed' } }),
      (entry) => entry !== null,
    );
    expect(audit).toMatchObject({ actorId: me.id, metadata: { otherSessionsRevoked: 1 } });
  });

  it('refuses a wrong current password with 403, not 401, and audits the attempt', async () => {
    // 401 would read as an expired session: the web client would try to refresh it.
    const me = await account();
    const res = await change(me.token, {
      currentPassword: 'Otra-Clave-2026',
      newPassword: NEW_PASSWORD,
    }).expect(403);
    expect(res.body.message).toBe('Current password is incorrect');

    await signIn(me.email).expect(200);
    await refresh(me.cookie).expect(200);
    const failed = await eventually(
      () =>
        prisma.auditLog.count({
          where: { entityId: me.id, action: 'auth.password_change_failed' },
        }),
      (n) => n > 0,
    );
    expect(failed).toBe(1);
  });

  it('asks for a new password that is strong and different', async () => {
    const me = await account();
    const same = await change(me.token, {
      currentPassword: PASSWORD,
      newPassword: PASSWORD,
    }).expect(400);
    expect(same.body.message).toBe('The new password must be different from the current one');

    const weak = await change(me.token, {
      currentPassword: PASSWORD,
      newPassword: 'corta1',
    }).expect(400);
    expect(weak.body.message).toEqual([
      'newPassword must have at least 10 characters, letters and numbers',
    ]);
    await signIn(me.email).expect(200);
  });

  it('is only for a signed-in, active account', async () => {
    await http()
      .post('/api/auth/change-password')
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(401);

    // Deactivated after signing in: the access token is still valid for a few minutes.
    const me = await account();
    await prisma.user.update({ where: { id: me.id }, data: { isActive: false } });
    await change(me.token, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(401);
  });

  describe('a password an administrator chose', () => {
    let admin: { id: string; token: string };

    beforeAll(async () => {
      const email = 'cpw-admin@e2e.local';
      const user = await prisma.user.create({
        data: { email, role: 'SUPER_ADMIN', passwordHash: await hashPassword(PASSWORD) },
      });
      admin = { id: user.id, token: (await signIn(email).expect(200)).body.accessToken };
    });

    /** An account the administrator creates with a password of their choosing. */
    async function issued() {
      const email = `cpw-issued-${++seq}@e2e.local`;
      await http()
        .post('/api/users')
        .set(bearer(admin.token))
        .send({ email, password: PASSWORD, role: 'HR' })
        .expect(201);
      const res = await signIn(email).expect(200);
      return { email, res, token: res.body.accessToken as string, cookie: refreshCookieOf(res) };
    }

    it('must be replaced before the account can do anything else', async () => {
      const { res, token, cookie } = await issued();
      expect(res.body.user.mustChangePassword).toBe(true);

      const blocked = await http().get('/api/employees').set(bearer(token)).expect(403);
      expect(blocked.body.message).toBe('Password change required');
      const me = await http().get('/api/auth/me').set(bearer(token)).expect(200);
      expect(me.body.mustChangePassword).toBe(true);

      await change(token, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(204);
      // The token in hand still says "pending" (it is stateless): a refresh issues a clean one.
      const renewed = await refresh(cookie).expect(200);
      expect(renewed.body.user.mustChangePassword).toBe(false);
      await http().get('/api/employees').set(bearer(renewed.body.accessToken)).expect(200);
    });

    it('still lets the owner sign out', async () => {
      const { token, cookie } = await issued();
      await http().post('/api/auth/logout').set(bearer(token)).expect(204);
      await refresh(cookie).expect(401);
    });

    it('opens no realtime connection meanwhile', async () => {
      const { token } = await issued();
      const { port } = app.getHttpServer().address() as AddressInfo;
      const socket = io(`http://127.0.0.1:${port}${REALTIME_NAMESPACE}`, {
        auth: { token },
        transports: ['websocket'],
      });
      try {
        const reason = await new Promise<string>((resolve) => socket.once('disconnect', resolve));
        expect(reason).toBe('io server disconnect');
      } finally {
        socket.disconnect();
      }
    });

    it('is required again after a reset, unless administrators reset their own', async () => {
      const me = await account();
      const target = await prisma.user.findUniqueOrThrow({ where: { email: me.email } });
      await http()
        .post(`/api/users/${target.id}/reset-password`)
        .set(bearer(admin.token))
        .send({ password: NEW_PASSWORD })
        .expect(204);
      expect((await signIn(me.email, NEW_PASSWORD).expect(200)).body.user.mustChangePassword).toBe(
        true,
      );

      await http()
        .post(`/api/users/${admin.id}/reset-password`)
        .set(bearer(admin.token))
        .send({ password: NEW_PASSWORD })
        .expect(204);
      const own = await signIn('cpw-admin@e2e.local', NEW_PASSWORD).expect(200);
      expect(own.body.user.mustChangePassword).toBe(false);
      admin.token = own.body.accessToken;
    });
  });
});
