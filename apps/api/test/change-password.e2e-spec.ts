import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
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
});
