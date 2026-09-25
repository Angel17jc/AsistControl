import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { bearer, createApp, createFixture, type Fixture, login } from './utils';

/**
 * An employee's schedule history: assigning a new schedule closes the previous one the day
 * before, and every date travels as a calendar date (`YYYY-MM-DD`).
 */
describe('Schedule assignments (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let fx: Fixture;
  let hr: string;
  let nightScheduleId: string;
  const http = () => request(app.getHttpServer());
  const history = (employeeId = fx.teammate.id, token = hr) =>
    http().get(`/api/employees/${employeeId}/schedules`).set(bearer(token));
  const assign = (body: object, token = hr) =>
    http().post('/api/work-schedules/assignments').set(bearer(token)).send(body);

  beforeAll(async () => {
    app = await createApp();
    prisma = new PrismaClient();
    fx = await createFixture(prisma, 'sch');
    hr = await login(app, fx.emails.hr);

    const shift = await prisma.workShift.create({
      data: { name: 'Night sch', startTime: '22:00', endTime: '06:00' },
    });
    const res = await http()
      .post('/api/work-schedules')
      .set(bearer(hr))
      .send({
        name: 'Nights sch',
        days: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, shiftId: shift.id })),
      })
      .expect(201);
    nightScheduleId = res.body.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('lists the history with calendar dates', async () => {
    const res = await history().expect(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        schedule: expect.objectContaining({ name: 'Every day sch' }),
      }),
    ]);
  });

  it('closes the previous assignment the day before the new one', async () => {
    const created = await assign({
      employeeId: fx.teammate.id,
      scheduleId: nightScheduleId,
      effectiveFrom: '2026-09-01',
    }).expect(201);
    expect(created.body).toMatchObject({
      effectiveFrom: '2026-09-01',
      effectiveTo: null,
      schedule: { id: nightScheduleId, name: 'Nights sch' },
    });

    const res = await history().expect(200);
    expect(
      res.body.map(
        (a: { schedule: { name: string }; effectiveFrom: string; effectiveTo: string | null }) => [
          a.schedule.name,
          a.effectiveFrom,
          a.effectiveTo,
        ],
      ),
    ).toEqual([
      ['Nights sch', '2026-09-01', null],
      ['Every day sch', '2026-01-01', '2026-08-31'],
    ]);
  });

  it('refuses a start that is not after the latest assignment', async () => {
    await assign({
      employeeId: fx.teammate.id,
      scheduleId: nightScheduleId,
      effectiveFrom: '2026-09-01',
    }).expect(400);
  });

  it('answers 404 for an unknown employee or schedule', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    await history(unknown).expect(404);
    await assign({
      employeeId: unknown,
      scheduleId: nightScheduleId,
      effectiveFrom: '2026-10-01',
    }).expect(404);
    await assign({
      employeeId: fx.employee.id,
      scheduleId: unknown,
      effectiveFrom: '2026-10-01',
    }).expect(404);
  });

  it('is reserved to HR and admins', async () => {
    const supervisor = await login(app, fx.emails.supervisor);
    await history(fx.teammate.id, supervisor).expect(403);
    await assign(
      { employeeId: fx.teammate.id, scheduleId: nightScheduleId, effectiveFrom: '2026-12-01' },
      supervisor,
    ).expect(403);
  });
});
