import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { at, bearer, createApp, createFixture, type Fixture, login, WORK_DATE } from './utils';

/**
 * Clients word errors from `code` and `params` (ADR 0014). This pins the contract end to end;
 * each business rule has its own tests where it lives.
 */
describe('Error contract (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let fx: Fixture;
  let hr: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
    prisma = new PrismaClient();
    fx = await createFixture(prisma, 'err');
    hr = await login(app, fx.emails.hr);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('says which rule of which field failed, and keeps the English message', async () => {
    const res = await http()
      .post('/api/employees')
      .set(bearer(hr))
      .send({
        employeeCode: 'A B',
        identification: 'errv00001',
        firstName: 'Ana',
        lastName: 'Vera',
        hireDate: WORK_DATE,
        phone: 'abc',
      })
      .expect(400);

    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.params.violations).toEqual(
      expect.arrayContaining([
        { field: 'employeeCode', rule: 'matches' },
        { field: 'phone', rule: 'matches' },
      ]),
    );
    expect(res.body.message).toEqual(
      expect.arrayContaining(['employeeCode must be 2-20 letters, digits or -']),
    );
  });

  it('gives nested fields their path and reports unknown properties', async () => {
    const nested = await http()
      .post('/api/attendance/events/batch')
      .set(bearer(hr))
      .send({ employeeId: fx.employee.id, reason: 'Motivo', punches: [{ occurredAt: 'nope' }] })
      .expect(400);
    expect(nested.body.params.violations).toEqual([
      { field: 'punches.0.occurredAt', rule: 'isIso8601' },
    ]);

    const unknown = await http()
      .post('/api/attendance/events/preview')
      .set(bearer(hr))
      .send({ employeeId: fx.employee.id, punches: [{ occurredAt: at('08:00') }], isAdmin: true })
      .expect(400);
    expect(unknown.body.params.violations).toEqual([
      { field: 'isAdmin', rule: 'whitelistValidation' },
    ]);
  });

  it('does not let a huge payload produce a huge answer', async () => {
    const res = await http()
      .post('/api/attendance/events/batch')
      .set(bearer(hr))
      .send({
        employeeId: fx.employee.id,
        reason: 'Motivo',
        punches: Array.from({ length: 80 }, () => ({ occurredAt: 'n', punchType: 'n' })),
      })
      .expect(400);
    expect(res.body.params.violations.length).toBeLessThanOrEqual(50);
  });

  it('reports a broken attendance rule with the same shape', async () => {
    const admin = await login(app, fx.emails.admin);
    const res = await http()
      .patch('/api/settings/attendance-policy')
      .set(bearer(admin))
      .send({ lateToleranceMinutes: -5 })
      .expect(400);
    expect(res.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      params: { violations: [{ field: 'lateToleranceMinutes', rule: 'too_small' }] },
    });
  });

  it('carries the values of a business rule', async () => {
    const res = await http()
      .get('/api/attendance/records?from=2026-01-01&to=2026-12-31')
      .set(bearer(hr))
      .expect(400);
    expect(res.body).toMatchObject({ code: 'DATE_RANGE_TOO_LONG', params: { maxDays: 93 } });
  });

  it('names what is duplicated by its property', async () => {
    const employee = {
      employeeCode: 'ERRDUP1',
      identification: 'errdup001',
      firstName: 'Ana',
      lastName: 'Vera',
      hireDate: WORK_DATE,
    };
    await http().post('/api/employees').set(bearer(hr)).send(employee).expect(201);
    const res = await http()
      .post('/api/employees')
      .set(bearer(hr))
      .send({ ...employee, identification: 'errdup002' })
      .expect(409);
    expect(res.body).toMatchObject({
      code: 'DUPLICATE_RECORD',
      params: { fields: ['employeeCode'] },
    });
  });

  it('covers sessions, permissions and what has no code of its own', async () => {
    const wrong = await http()
      .post('/api/auth/login')
      .send({ email: fx.emails.hr, password: 'not-the-password' })
      .expect(401);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');

    const anonymous = await http().get('/api/employees').expect(401);
    expect(anonymous.body.code).toBe('SESSION_EXPIRED');

    const forbidden = await http().get('/api/users').set(bearer(hr)).expect(403);
    expect(forbidden.body.code).toBe('FORBIDDEN');

    const route = await http().get('/api/no-such-route').set(bearer(hr)).expect(404);
    expect(route.body.code).toBe('NOT_FOUND');

    const badId = await http().get('/api/employees/not-a-uuid').set(bearer(hr)).expect(400);
    expect(badId.body.code).toBe('BAD_REQUEST');
  });
});
