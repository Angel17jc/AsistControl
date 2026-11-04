import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { WORK_DATE, at, bearer, createApp, createFixture, type Fixture, login } from './utils';

/**
 * A company without fixed hours that does not pay overtime: people enter and leave at
 * different hours, nobody is late, and the only thing reported is a day short of its hours.
 */
describe('Shifts without fixed hours (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let fx: Fixture;
  let hr: string;
  let admin: string;
  const http = () => request(app.getHttpServer());

  const punches = async (employeeId: string, date: string, hours: string[]) => {
    for (const hhmm of hours) {
      await http()
        .post('/api/attendance/events')
        .set(bearer(hr))
        .send({ employeeId, occurredAt: at(hhmm, date), reason: 'prueba' })
        .expect(201);
    }
  };
  const dayOf = async (employeeId: string, date: string) => {
    const res = await http()
      .get('/api/attendance/records')
      .query({ from: date, to: date, employeeId })
      .set(bearer(hr))
      .expect(200);
    return (res.body as { data: Record<string, unknown>[] }).data[0]!;
  };
  const setPolicy = (body: object) =>
    http().patch('/api/settings/attendance-policy').set(bearer(admin)).send(body).expect(200);

  beforeAll(async () => {
    app = await createApp();
    prisma = new PrismaClient();
    fx = await createFixture(prisma, 'flx');
    hr = await login(app, fx.emails.hr);
    admin = await login(app, fx.emails.admin);

    const shift = await http()
      .post('/api/work-shifts')
      .set(bearer(hr))
      .send({
        name: 'Jornada flx',
        startTime: '08:00',
        endTime: '17:00',
        breakStart: '13:00',
        breakEnd: '14:00',
        flexible: true,
      })
      .expect(201);
    expect(shift.body).toMatchObject({ flexible: true });
    const schedule = await http()
      .post('/api/work-schedules')
      .set(bearer(hr))
      .send({
        name: 'Semana flx',
        days: [1, 2, 3, 4, 5].map((weekday) => ({
          weekday,
          shiftId: (shift.body as { id: string }).id,
        })),
      })
      .expect(201);
    for (const employeeId of [fx.employee.id, fx.teammate.id]) {
      await http()
        .post('/api/work-schedules/assignments')
        .set(bearer(hr))
        .send({
          employeeId,
          scheduleId: (schedule.body as { id: string }).id,
          effectiveFrom: '2026-09-01',
        })
        .expect(201);
    }
  });

  afterAll(async () => {
    await setPolicy({ overtimeEnabled: true });
    await prisma.$disconnect();
    await app.close();
  });

  it('refuses a reference day that crosses midnight', async () => {
    const res = await http()
      .post('/api/work-shifts')
      .set(bearer(hr))
      .send({ name: 'Noche flx', startTime: '22:00', endTime: '06:00', flexible: true })
      .expect(400);
    expect(res.body).toMatchObject({ code: 'FLEXIBLE_SHIFT_OVERNIGHT' });
  });

  it('reads a day entered at 09:00 and left at 20:00 as present, with no schedule to show', async () => {
    await punches(fx.employee.id, WORK_DATE, ['09:00', '13:00', '14:00', '20:00']);
    expect(await dayOf(fx.employee.id, WORK_DATE)).toMatchObject({
      status: 'PRESENT',
      workedMinutes: 10 * 60,
      breakMinutes: 60,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      overtimeMinutes: 2 * 60,
      shortMinutes: 0,
      scheduledStart: null,
      scheduledEnd: null,
    });
  });

  it('reports a closed day short of its hours', async () => {
    await punches(fx.teammate.id, WORK_DATE, ['09:00', '13:00', '14:00', '17:00']);
    const day = await dayOf(fx.teammate.id, WORK_DATE);
    expect(day).toMatchObject({ status: 'PRESENT', workedMinutes: 7 * 60, shortMinutes: 60 });
    expect(day.anomalies).toContain('SHORT_HOURS');
  });

  describe('when the company does not pay overtime', () => {
    const features = (token: string) =>
      http().get('/api/settings/features').set(bearer(token)).expect(200);
    const pendingOvertime = () =>
      prisma.overtimeRecord.count({ where: { employeeId: fx.employee.id, status: 'PENDING' } });

    it('tells any signed-in person, who cannot read the settings', async () => {
      const employee = await login(app, fx.emails.employee);
      await http().get('/api/settings').set(bearer(employee)).expect(403);
      expect((await features(employee)).body).toEqual({ overtimeEnabled: true });
      await setPolicy({ overtimeEnabled: false });
      expect((await features(employee)).body).toEqual({ overtimeEnabled: false });
    });

    it('drops what was proposed when the days are recalculated', async () => {
      expect(await pendingOvertime()).toBe(1);
      await http()
        .post('/api/attendance/recompute')
        .set(bearer(hr))
        .send({ from: WORK_DATE, to: WORK_DATE })
        .expect(201);
      expect(await dayOf(fx.employee.id, WORK_DATE)).toMatchObject({
        workedMinutes: 10 * 60,
        overtimeMinutes: 0,
      });
      expect(await pendingOvertime()).toBe(0);
    });
  });
});
