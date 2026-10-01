import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { hashPassword } from '../src/auth/password-hashing';
import { PASSWORD, bearer, createApp, createFixture, type Fixture, login } from './utils';

const NEW_PASSWORD = 'Cuenta-Nueva-2026';

/**
 * Platform accounts: who may create and change them, the rules that keep an account useful
 * (a supervisor or an employee is linked to a person) and the ones that keep it safe
 * (deactivation and password resets end every session).
 */
describe('User accounts (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let fx: Fixture;
  let superAdmin: string;
  let admin: string;
  const http = () => request(app.getHttpServer());
  const create = (body: object, token = superAdmin) =>
    http().post('/api/users').set(bearer(token)).send(body);
  const update = (id: string, body: object, token = superAdmin) =>
    http().patch(`/api/users/${id}`).set(bearer(token)).send(body);
  const signIn = (email: string, password: string) =>
    http().post('/api/auth/login').send({ email, password });
  /** "name=value" of the refresh cookie a response sets. */
  const refreshCookieOf = (res: request.Response) =>
    String(res.headers['set-cookie']).split(';')[0]!;
  /** Refreshes a session, which must succeed, and returns the rotated cookie. */
  const refreshed = async (cookie: string) =>
    refreshCookieOf(await http().post('/api/auth/refresh').set('Cookie', cookie).expect(200));

  beforeAll(async () => {
    app = await createApp();
    prisma = new PrismaClient();
    fx = await createFixture(prisma, 'usr');
    superAdmin = await login(app, fx.emails.admin);
    await prisma.user.create({
      data: {
        email: 'plain-admin-usr@e2e.local',
        role: 'ADMIN',
        passwordHash: await hashPassword(PASSWORD),
      },
    });
    admin = await login(app, 'plain-admin-usr@e2e.local');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('creates an account and never returns its password hash', async () => {
    const res = await create({
      email: 'Nomina.USR@e2e.local',
      password: NEW_PASSWORD,
      role: 'HR',
    }).expect(201);
    expect(res.body).toMatchObject({ email: 'nomina.usr@e2e.local', role: 'HR', isActive: true });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);
    await signIn('nomina.usr@e2e.local', NEW_PASSWORD).expect(200);
  });

  describe('a supervisor or an employee', () => {
    let accountId: string;

    it('cannot exist without a linked employee: it would see nothing', async () => {
      const res = await create({
        email: 'nadie-usr@e2e.local',
        password: NEW_PASSWORD,
        role: 'EMPLOYEE',
      }).expect(400);
      expect(res.body.message).toBe('A EMPLOYEE account must be linked to an employee');
    });

    it('is linked to a person, who then shows as having an account', async () => {
      const res = await create({
        email: 'companera-usr@e2e.local',
        password: NEW_PASSWORD,
        role: 'EMPLOYEE',
        employeeId: fx.teammate.id,
      }).expect(201);
      accountId = res.body.id;
      expect(res.body.employee).toMatchObject({ id: fx.teammate.id });

      const employee = await http()
        .get(`/api/employees/${fx.teammate.id}`)
        .set(bearer(superAdmin))
        .expect(200);
      expect(employee.body.user).toEqual({
        id: accountId,
        email: 'companera-usr@e2e.local',
        isActive: true,
      });
    });

    it('cannot be unlinked, unless the role changes to one that needs no employee', async () => {
      await update(accountId, { employeeId: null }).expect(400);
      await update(accountId, { role: 'SUPERVISOR', employeeId: null }).expect(400);
      const res = await update(accountId, { role: 'HR', employeeId: null }).expect(200);
      expect(res.body).toMatchObject({ role: 'HR', employee: null });
      // Back to an employee account, linked again.
      await update(accountId, { role: 'EMPLOYEE', employeeId: fx.teammate.id }).expect(200);
    });
  });

  it('refuses a taken email or a person who already has an account', async () => {
    await create({ email: fx.emails.hr, password: NEW_PASSWORD, role: 'HR' }).expect(409);
    await create({
      email: 'segunda-cuenta-usr@e2e.local',
      password: NEW_PASSWORD,
      role: 'EMPLOYEE',
      employeeId: fx.employee.id,
    }).expect(409);
  });

  it('refuses weak passwords', async () => {
    await create({ email: 'debil-usr@e2e.local', password: 'corta1', role: 'HR' }).expect(400);
    await create({ email: 'debil-usr@e2e.local', password: 'sololetrasaqui', role: 'HR' }).expect(
      400,
    );
  });

  describe('administrator accounts', () => {
    it('are created and changed by a super admin only', async () => {
      await create(
        { email: 'admin2-usr@e2e.local', password: NEW_PASSWORD, role: 'ADMIN' },
        admin,
      ).expect(403);
      const superAdminAccount = await prisma.user.findUniqueOrThrow({
        where: { email: fx.emails.admin },
      });
      await update(superAdminAccount.id, { isActive: false }, admin).expect(403);
      // An admin still manages everyone else.
      await create(
        { email: 'rrhh2-usr@e2e.local', password: NEW_PASSWORD, role: 'HR' },
        admin,
      ).expect(201);
    });

    it('cannot change their own role or deactivate themselves', async () => {
      const me = await prisma.user.findUniqueOrThrow({ where: { email: fx.emails.admin } });
      await update(me.id, { role: 'HR' }).expect(400);
      await update(me.id, { isActive: false }).expect(400);
    });
  });

  it('ends every session on deactivation, and the account can no longer sign in', async () => {
    const account = await create({
      email: 'temporal-usr@e2e.local',
      password: NEW_PASSWORD,
      role: 'HR',
    }).expect(201);
    const session = await signIn('temporal-usr@e2e.local', NEW_PASSWORD).expect(200);
    // Control: the session refreshes while the account is active, so a later 401 is about
    // the deactivation, not a malformed cookie. Refreshing rotates it: keep the new one.
    const cookie = await refreshed(refreshCookieOf(session));

    await update(account.body.id, { isActive: false }).expect(200);
    await signIn('temporal-usr@e2e.local', NEW_PASSWORD).expect(401);
    await http().post('/api/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('resets a password: the old one stops working, sessions end', async () => {
    const account = await create({
      email: 'olvido-usr@e2e.local',
      password: NEW_PASSWORD,
      role: 'HR',
    }).expect(201);
    const session = await signIn('olvido-usr@e2e.local', NEW_PASSWORD).expect(200);
    const cookie = await refreshed(refreshCookieOf(session));

    await http()
      .post(`/api/users/${account.body.id}/reset-password`)
      .set(bearer(superAdmin))
      .send({ password: 'Restablecida-2026' })
      .expect(204);
    await signIn('olvido-usr@e2e.local', NEW_PASSWORD).expect(401);
    await signIn('olvido-usr@e2e.local', 'Restablecida-2026').expect(200);
    await http().post('/api/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('is reserved to administrators', async () => {
    const hr = await login(app, fx.emails.hr);
    await http().get('/api/users').set(bearer(hr)).expect(403);
    await create({ email: 'x-usr@e2e.local', password: NEW_PASSWORD, role: 'HR' }, hr).expect(403);
  });
});
