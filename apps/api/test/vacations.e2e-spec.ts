import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { bearer, createApp, createFixture, type Fixture, login } from './utils';

/**
 * Vacation balances end to end. The fixture employee was hired on 2026-01-01 and works every
 * day of the week, so every date counts as a working day unless it is a holiday.
 * Dates are in 2027: after the first anniversary, whatever day the suite runs.
 */
describe('Vacation balances (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let fx: Fixture;
  const tokens = {} as Record<'admin' | 'hr' | 'supervisor' | 'employee', string>;
  let contractTypeId: string;
  const http = () => request(app.getHttpServer());

  const balance = (asOf: string, token = tokens.hr, employeeId = fx.employee.id) =>
    http().get(`/api/employees/${employeeId}/vacation-balance?asOf=${asOf}`).set(bearer(token));
  const vacation = (from: string, to: string, token = tokens.employee) =>
    http()
      .post('/api/leave-requests')
      .set(bearer(token))
      .send({
        type: 'VACATION',
        startsAt: `${from}T00:00:00-05:00`,
        endsAt: `${to}T00:00:00-05:00`,
        reason: 'Vacaciones',
      });

  beforeAll(async () => {
    app = await createApp();
    prisma = new PrismaClient();
    fx = await createFixture(prisma, 'vac');
    for (const role of ['admin', 'hr', 'supervisor', 'employee'] as const) {
      tokens[role] = await login(app, fx.emails[role]);
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('contract types', () => {
    it('creates one with its vacation rules; the values are the company’s', async () => {
      const res = await http()
        .post('/api/contract-types')
        .set(bearer(tokens.hr))
        .send({ name: 'Tiempo completo vac', vacationDaysPerYear: 15 })
        .expect(201);
      contractTypeId = res.body.id;
      expect(res.body).toEqual({
        id: contractTypeId,
        name: 'Tiempo completo vac',
        vacationDaysPerYear: 15,
        vacationAccrual: 'ANNUAL',
        vacationDayCounting: 'WORKING_DAYS',
        seniority: null,
        vacationExpiryMonths: null,
        allowHalfDayVacations: false,
        allowNegativeVacationBalance: false,
      });
    });

    it('rejects duplicates and nonsense', async () => {
      const create = (body: object) =>
        http().post('/api/contract-types').set(bearer(tokens.hr)).send(body);
      await create({ name: 'Tiempo completo vac', vacationDaysPerYear: 10 }).expect(409);
      await create({ name: 'Negativo', vacationDaysPerYear: -1 }).expect(400);
      await create({ name: 'Decimales', vacationDaysPerYear: 1.234 }).expect(400);
      await create({
        name: 'Incompleto',
        vacationDaysPerYear: 15,
        seniority: { afterYears: 5 },
      }).expect(400);
    });

    it('is managed by HR and admins, not by employees', async () => {
      await http().get('/api/contract-types').set(bearer(tokens.employee)).expect(403);
      await http()
        .post('/api/contract-types')
        .set(bearer(tokens.supervisor))
        .send({ name: 'Supervisores', vacationDaysPerYear: 15 })
        .expect(403);
    });
  });

  describe('the balance', () => {
    it('is only adjustments while the employee has no contract type', async () => {
      const res = await balance('2027-01-01').expect(200);
      expect(res.body).toMatchObject({ contractType: null, accruedDays: 0, availableDays: 0 });
    });

    it('accrues once a contract type is assigned', async () => {
      await http()
        .patch(`/api/employees/${fx.employee.id}`)
        .set(bearer(tokens.hr))
        .send({ contractTypeId })
        .expect(200);

      expect((await balance('2026-12-31').expect(200)).body).toMatchObject({
        accruedDays: 0,
        availableDays: 0,
        accrual: { completedServiceYears: 0, nextCreditOn: '2027-01-01' },
      });
      expect((await balance('2027-01-01').expect(200)).body).toMatchObject({
        contractType: { name: 'Tiempo completo vac' },
        accruedDays: 15,
        availableDays: 15,
      });
    });

    it('is visible to the employee and their supervisor, not to other employees', async () => {
      await balance('2027-01-01', tokens.employee).expect(200);
      await balance('2027-01-01', tokens.supervisor).expect(200);
      await balance('2027-01-01', tokens.employee, fx.teammate.id).expect(403);
    });

    it('takes manual adjustments, justified and audited, from HR only', async () => {
      await http()
        .post(`/api/employees/${fx.employee.id}/vacation-adjustments`)
        .set(bearer(tokens.employee))
        .send({ days: 30, reason: 'Me los regalo' })
        .expect(403);
      await http()
        .post(`/api/employees/${fx.employee.id}/vacation-adjustments`)
        .set(bearer(tokens.hr))
        .send({ days: 0, reason: 'Nada' })
        .expect(400);

      const res = await http()
        .post(`/api/employees/${fx.employee.id}/vacation-adjustments`)
        .set(bearer(tokens.hr))
        .send({ days: 3, reason: 'Saldo del sistema anterior' })
        .expect(201);
      expect(res.body.days).toBe(3);

      const after = (await balance('2027-01-01').expect(200)).body;
      expect(after).toMatchObject({ adjustmentDays: 3, availableDays: 18 });
      expect(after.adjustments[0]).toMatchObject({ days: 3, reason: 'Saldo del sistema anterior' });
      expect(
        await prisma.auditLog.count({
          where: { action: 'vacation.adjusted', entityId: fx.employee.id },
        }),
      ).toBe(1);
    });
  });

  describe('requests against the balance', () => {
    let first: string;

    it('reserves the days of a pending vacation', async () => {
      // 4 → 8 January: five working days.
      first = (await vacation('2027-01-04', '2027-01-09').expect(201)).body.id;
      expect((await balance('2027-01-01').expect(200)).body).toMatchObject({
        pendingDays: 5,
        availableDays: 13,
      });
    });

    it('refuses a vacation the balance cannot cover, saying how much is left', async () => {
      // 1 → 19 February: 19 days, 13 available.
      const res = await vacation('2027-02-01', '2027-02-20').expect(409);
      expect(res.body.message).toBe(
        'Insufficient vacation balance: 13 day(s) available on 2027-02-01, the request uses 19',
      );
    });

    it('does not charge holidays when counting working days', async () => {
      await http()
        .post('/api/holidays')
        .set(bearer(tokens.admin))
        .send({ date: '2027-03-02', name: 'Feriado de prueba vac' })
        .expect(201);
      const before = (await balance('2027-01-01').expect(200)).body.pendingDays;
      // 1 → 3 March with a holiday on the 2nd: two days.
      await vacation('2027-03-01', '2027-03-04').expect(201);
      expect((await balance('2027-01-01').expect(200)).body.pendingDays).toBe(before + 2);
    });

    it('moves approved days to scheduled, then to used once they pass', async () => {
      await http()
        .post(`/api/leave-requests/${first}/review`)
        .set(bearer(tokens.supervisor))
        .send({ decision: 'APPROVED' })
        .expect(201);

      expect((await balance('2027-01-01').expect(200)).body).toMatchObject({
        scheduledDays: 5,
        usedDays: 0,
        pendingDays: 2,
      });
      expect((await balance('2027-01-10').expect(200)).body).toMatchObject({
        scheduledDays: 0,
        usedDays: 5,
      });
    });

    it('checks the balance again on approval', async () => {
      // Fits today (available 11 → uses 4)…
      const pending = (await vacation('2027-04-05', '2027-04-09').expect(201)).body.id;
      // …but HR withdraws days before anyone approves it.
      await http()
        .post(`/api/employees/${fx.employee.id}/vacation-adjustments`)
        .set(bearer(tokens.hr))
        .send({ days: -10, reason: 'Corrección de saldo inicial' })
        .expect(201);
      const res = await http()
        .post(`/api/leave-requests/${pending}/review`)
        .set(bearer(tokens.supervisor))
        .send({ decision: 'APPROVED' })
        .expect(409);
      expect(res.body.message).toMatch(/^Insufficient vacation balance/);
    });

    it('allows an advance when the contract type says so', async () => {
      await http()
        .patch(`/api/contract-types/${contractTypeId}`)
        .set(bearer(tokens.hr))
        .send({ allowNegativeVacationBalance: true })
        .expect(200);
      await vacation('2027-05-03', '2027-05-22').expect(201);
      expect((await balance('2027-01-01').expect(200)).body.availableDays).toBeLessThan(0);
    });

    it('recomputes from the rules: editing the contract type changes the balance at once', async () => {
      const before = (await balance('2027-01-01').expect(200)).body.accruedDays;
      await http()
        .patch(`/api/contract-types/${contractTypeId}`)
        .set(bearer(tokens.hr))
        .send({ vacationDaysPerYear: 20 })
        .expect(200);
      expect((await balance('2027-01-01').expect(200)).body.accruedDays).toBe(before + 5);
    });
  });

  describe('expiry of unused days', () => {
    // The teammate: hired 2026-01-01 like everyone in the fixture, no adjustments.
    const teammateBalance = (asOf: string) => balance(asOf, tokens.hr, fx.teammate.id);
    let expiringTypeId: string;

    it('loses what a service year left unused, the configured months after its anniversary', async () => {
      expiringTypeId = (
        await http()
          .post('/api/contract-types')
          .set(bearer(tokens.hr))
          .send({ name: 'Con caducidad vac', vacationDaysPerYear: 15, vacationExpiryMonths: 12 })
          .expect(201)
      ).body.id;
      await http()
        .patch(`/api/employees/${fx.teammate.id}`)
        .set(bearer(tokens.hr))
        .send({ contractTypeId: expiringTypeId })
        .expect(200);

      expect((await teammateBalance('2027-12-31').expect(200)).body).toMatchObject({
        accruedDays: 15,
        expiredDays: 0,
        availableDays: 15,
        nextExpiry: { date: '2028-01-01', days: 15 },
      });
      expect((await teammateBalance('2028-01-01').expect(200)).body).toMatchObject({
        accruedDays: 30,
        expiredDays: 15,
        availableDays: 15,
        nextExpiry: { date: '2029-01-01', days: 15 },
      });
    });

    it('only loses the days that were not taken', async () => {
      // 7 → 11 June 2027: five days of year one, approved by HR.
      const leave = await http()
        .post('/api/leave-requests')
        .set(bearer(tokens.hr))
        .send({
          employeeId: fx.teammate.id,
          type: 'VACATION',
          startsAt: '2027-06-07T00:00:00-05:00',
          endsAt: '2027-06-12T00:00:00-05:00',
          reason: 'Vacaciones',
        })
        .expect(201);
      await http()
        .post(`/api/leave-requests/${leave.body.id}/review`)
        .set(bearer(tokens.hr))
        .send({ decision: 'APPROVED' })
        .expect(201);

      expect((await teammateBalance('2027-12-31').expect(200)).body.nextExpiry).toEqual({
        date: '2028-01-01',
        days: 10,
      });
      expect((await teammateBalance('2028-01-01').expect(200)).body).toMatchObject({
        usedDays: 5,
        expiredDays: 10,
        availableDays: 15,
      });
    });

    it('checks a request against the balance left after expiry', async () => {
      // 1 → 20 February 2028: twenty days, but only year two's 15 are still valid.
      const res = await http()
        .post('/api/leave-requests')
        .set(bearer(tokens.hr))
        .send({
          employeeId: fx.teammate.id,
          type: 'VACATION',
          startsAt: '2028-02-01T00:00:00-05:00',
          endsAt: '2028-02-21T00:00:00-05:00',
          reason: 'Vacaciones',
        })
        .expect(409);
      expect(res.body.message).toBe(
        'Insufficient vacation balance: 15 day(s) available on 2028-02-01, the request uses 20',
      );
    });

    it('gives the days back when the rule is removed', async () => {
      await http()
        .patch(`/api/contract-types/${expiringTypeId}`)
        .set(bearer(tokens.hr))
        .send({ vacationExpiryMonths: null })
        .expect(200);
      expect((await teammateBalance('2028-01-01').expect(200)).body).toMatchObject({
        expiredDays: 0,
        availableDays: 25,
        nextExpiry: null,
      });
    });

    it('rejects a nonsensical expiry', async () => {
      const patch = (vacationExpiryMonths: unknown) =>
        http()
          .patch(`/api/contract-types/${expiringTypeId}`)
          .set(bearer(tokens.hr))
          .send({ vacationExpiryMonths });
      await patch(0).expect(400);
      await patch(1.5).expect(400);
      await patch(121).expect(400);
    });
  });

  describe('half days', () => {
    // The supervisor: hired 2026-01-01, 08:00-17:00 with lunch 12:00-13:00 every day.
    const request = (date: string, from: string, to: string) =>
      http()
        .post('/api/leave-requests')
        .set(bearer(tokens.hr))
        .send({
          employeeId: fx.supervisor.id,
          type: 'VACATION',
          startsAt: `${date}T${from}:00-05:00`,
          endsAt: `${date}T${to}:00-05:00`,
          reason: 'Medio día',
        });
    const pending = async () =>
      (await balance('2027-01-15', tokens.hr, fx.supervisor.id).expect(200)).body.pendingDays;
    let halfDayTypeId: string;

    it('prices a morning at half a day when the contract allows it', async () => {
      halfDayTypeId = (
        await http()
          .post('/api/contract-types')
          .set(bearer(tokens.hr))
          .send({ name: 'Medios días vac', vacationDaysPerYear: 15, allowHalfDayVacations: true })
          .expect(201)
      ).body.id;
      await http()
        .patch(`/api/employees/${fx.supervisor.id}`)
        .set(bearer(tokens.hr))
        .send({ contractTypeId: halfDayTypeId })
        .expect(200);

      await request('2027-02-01', '08:00', '12:00').expect(201);
      expect(await pending()).toBe(0.5);
    });

    it('charges a whole day for more than half the working time', async () => {
      // 08:00-14:00 is five of the eight working hours.
      await request('2027-02-02', '08:00', '14:00').expect(201);
      expect(await pending()).toBe(1.5);
    });

    it('refuses one that misses the working time altogether', async () => {
      const res = await request('2027-02-03', '18:00', '20:00').expect(409);
      expect(res.body.message).toBe('The vacation covers no day that counts against the balance');
    });

    it('charges whole days when the contract does not allow half days', async () => {
      await http()
        .patch(`/api/contract-types/${halfDayTypeId}`)
        .set(bearer(tokens.hr))
        .send({ allowHalfDayVacations: false })
        .expect(200);
      expect(await pending()).toBe(2);
    });
  });

  describe('deleting a contract type', () => {
    it('is refused while employees use it, allowed once unused', async () => {
      const res = await http()
        .delete(`/api/contract-types/${contractTypeId}`)
        .set(bearer(tokens.hr))
        .expect(409);
      expect(res.body.message).toMatch(/used by 1 employee/);

      const spare = await http()
        .post('/api/contract-types')
        .set(bearer(tokens.hr))
        .send({ name: 'Temporal vac', vacationDaysPerYear: 7.5, vacationAccrual: 'MONTHLY' })
        .expect(201);
      await http()
        .delete(`/api/contract-types/${spare.body.id}`)
        .set(bearer(tokens.hr))
        .expect(204);
    });
  });
});
