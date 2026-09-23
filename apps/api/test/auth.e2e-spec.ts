import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import {
  PASSWORD,
  bearer,
  createApp,
  createFixture,
  eventually,
  type Fixture,
  login,
} from './utils';

describe('Auth, RBAC and API contract (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let fx: Fixture;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
    prisma = new PrismaClient();
    fx = await createFixture(prisma, 'auth');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('GET /health reports the database', async () => {
    const res = await http().get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'connected' });
  });

  describe('login', () => {
    it('returns an access token and sets the refresh token as an httpOnly cookie', async () => {
      const res = await http()
        .post('/api/auth/login')
        .send({ email: fx.emails.admin, password: PASSWORD })
        .expect(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.user).toMatchObject({ email: fx.emails.admin, role: 'SUPER_ADMIN' });
      expect(res.body).not.toHaveProperty('refreshToken');
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
      const cookie = String(res.headers['set-cookie']);
      expect(cookie).toMatch(/ac_refresh=.+; Path=\/api\/auth;.*HttpOnly;.*SameSite=Strict/);
    });

    it('answers the same generic error for unknown users and wrong passwords', async () => {
      const unknown = await http()
        .post('/api/auth/login')
        .send({ email: 'nobody@e2e.local', password: PASSWORD })
        .expect(401);
      const wrong = await http()
        .post('/api/auth/login')
        .send({ email: fx.emails.admin, password: 'wrong-password-1' })
        .expect(401);
      expect(unknown.body.message).toBe(wrong.body.message);
    });

    it('audits failed logins', async () => {
      await http()
        .post('/api/auth/login')
        .send({ email: fx.emails.hr, password: 'bad-password-123' });
      // The audit entry is written in the background, so the login answers first.
      const entries = await eventually(
        () =>
          prisma.auditLog.count({
            where: {
              action: 'auth.login_failed',
              metadata: { path: ['email'], equals: fx.emails.hr },
            },
          }),
        (count) => count > 0,
      );
      expect(entries).toBeGreaterThan(0);
    });

    it('validates the payload', async () => {
      const res = await http().post('/api/auth/login').send({ email: 'not-an-email' }).expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, path: '/api/auth/login' });
    });
  });

  describe('refresh token rotation', () => {
    it('rotates the cookie and revokes the session when an old token is replayed', async () => {
      const agent = request.agent(app.getHttpServer());
      await agent
        .post('/api/auth/login')
        .send({ email: fx.emails.hr, password: PASSWORD })
        .expect(200);

      const first = await agent.post('/api/auth/refresh').expect(200);
      const firstCookie = String(first.headers['set-cookie']).split(';')[0]!;
      const second = await agent.post('/api/auth/refresh').expect(200);
      expect(second.body.accessToken).toEqual(expect.any(String));

      // Replaying a rotated token = theft signal → whole session revoked.
      await http().post('/api/auth/refresh').set('Cookie', firstCookie).expect(401);
      await agent.post('/api/auth/refresh').expect(401);
    });

    it('logout revokes the session', async () => {
      const agent = request.agent(app.getHttpServer());
      const res = await agent
        .post('/api/auth/login')
        .send({ email: fx.emails.supervisor, password: PASSWORD })
        .expect(200);
      await agent.post('/api/auth/logout').set(bearer(res.body.accessToken)).expect(204);
      await agent.post('/api/auth/refresh').expect(401);
    });
  });

  describe('authorization', () => {
    it('rejects requests without a token', async () => {
      await http().get('/api/employees').expect(401);
    });

    it('rejects forged tokens', async () => {
      await http()
        .get('/api/employees')
        .set(bearer('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad'))
        .expect(401);
    });

    it('enforces role permissions', async () => {
      const employee = await login(app, fx.emails.employee);
      await http().get('/api/devices').set(bearer(employee)).expect(403);
      await http().post('/api/employees').set(bearer(employee)).send({}).expect(403);
      await http().get('/api/audit-logs').set(bearer(employee)).expect(403);
    });

    it('prevents HR from creating administrator accounts', async () => {
      const hr = await login(app, fx.emails.hr);
      await http()
        .post('/api/users')
        .set(bearer(hr))
        .send({ email: 'x@e2e.local', password: 'Password12345', role: 'ADMIN' })
        .expect(403);
    });

    it('scopes employee lists for supervisors', async () => {
      const token = await login(app, fx.emails.supervisor);
      const res = await http().get('/api/employees?pageSize=100').set(bearer(token)).expect(200);
      const ids = res.body.data.map((e: { id: string }) => e.id).sort();
      expect(ids).toEqual([fx.supervisor.id, fx.employee.id, fx.teammate.id].sort());
    });

    it('forbids a supervisor from reading an employee outside the team', async () => {
      const outsider = await prisma.employee.create({
        data: {
          employeeCode: 'AUTH-OUT',
          identification: 'authout01',
          firstName: 'Out',
          lastName: 'Sider',
          hireDate: new Date('2026-01-01'),
        },
      });
      const token = await login(app, fx.emails.supervisor);
      await http().get(`/api/employees/${outsider.id}`).set(bearer(token)).expect(403);
    });
  });

  describe('employees', () => {
    it('rejects unknown fields and returns the error contract', async () => {
      const token = await login(app, fx.emails.hr);
      const res = await http()
        .post('/api/employees')
        .set(bearer(token))
        .send({
          employeeCode: 'AUTH-9',
          identification: 'auth90000',
          firstName: 'A',
          lastName: 'B',
          hireDate: '2026-01-01',
          isAdmin: true,
        })
        .expect(400);
      expect(res.body.message).toContain('property isAdmin should not exist');
      expect(res.body).toHaveProperty('timestamp');
    });

    it('returns 409 on duplicate codes', async () => {
      const token = await login(app, fx.emails.hr);
      const body = {
        employeeCode: 'AUTH-DUP',
        identification: 'authdup01',
        firstName: 'A',
        lastName: 'B',
        hireDate: '2026-01-01',
      };
      await http().post('/api/employees').set(bearer(token)).send(body).expect(201);
      await http()
        .post('/api/employees')
        .set(bearer(token))
        .send({ ...body, identification: 'authdup02' })
        .expect(409);
    });

    it('soft deletes: the row stays for history and disappears from lists', async () => {
      const token = await login(app, fx.emails.hr);
      const created = await http()
        .post('/api/employees')
        .set(bearer(token))
        .send({
          employeeCode: 'AUTH-DEL',
          identification: 'authdel01',
          firstName: 'To',
          lastName: 'Delete',
          hireDate: '2026-01-01',
          biometricId: 'authdel',
        })
        .expect(201);
      await http().delete(`/api/employees/${created.body.id}`).set(bearer(token)).expect(204);
      await http().get(`/api/employees/${created.body.id}`).set(bearer(token)).expect(404);
      const row = await prisma.employee.findUnique({ where: { id: created.body.id } });
      expect(row?.deletedAt).not.toBeNull();
      expect(row?.biometricId).toBeNull();
    });
  });
});
