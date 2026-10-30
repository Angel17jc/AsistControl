import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { WORK_DATE, at, bearer, createApp, createFixture, type Fixture, login } from './utils';

describe('Attendance corrections, leave and reports (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let fx: Fixture;
  let hr: string;
  const http = () => request(app.getHttpServer());

  const record = async (employeeId: string, token = hr) =>
    (
      await http()
        .get(`/api/attendance/records?from=${WORK_DATE}&to=${WORK_DATE}&employeeId=${employeeId}`)
        .set(bearer(token))
        .expect(200)
    ).body.data[0];

  const manual = (employeeId: string, hhmm: string) =>
    http()
      .post('/api/attendance/events')
      .set(bearer(hr))
      .send({ employeeId, occurredAt: at(hhmm), reason: 'Olvidó marcar (e2e)' });

  beforeAll(async () => {
    app = await createApp();
    prisma = new PrismaClient();
    fx = await createFixture(prisma, 'att');
    hr = await login(app, fx.emails.hr);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('builds a day from manual corrections and audits each one', async () => {
    for (const t of ['08:01', '12:00', '13:00', '17:05'])
      await manual(fx.employee.id, t).expect(201);

    const r = await record(fx.employee.id);
    expect(r).toMatchObject({
      status: 'PRESENT',
      workedMinutes: 484,
      lateMinutes: 0,
      breakMinutes: 60,
    });
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'attendance.manual_event',
          metadata: { path: ['employeeId'], equals: fx.employee.id },
        },
      }),
    ).toBe(4);
  });

  it('rejects a duplicated manual punch', async () => {
    await manual(fx.employee.id, '08:01').expect(409);
  });

  it('rejects punches in the future', async () => {
    await http()
      .post('/api/attendance/events')
      .set(bearer(hr))
      .send({
        employeeId: fx.employee.id,
        occurredAt: new Date(Date.now() + 3_600_000).toISOString(),
        reason: 'future punch',
      })
      .expect(400);
  });

  it('voiding a punch keeps it for the audit trail and recomputes the day', async () => {
    const events = await prisma.attendanceEvent.findMany({
      where: { employeeId: fx.employee.id },
      orderBy: { occurredAt: 'asc' },
    });
    const exit = events.at(-1)!;
    await http()
      .post(`/api/attendance/events/${exit.id}/void`)
      .set(bearer(hr))
      .send({ reason: 'Marcación errónea' })
      .expect(201);

    const r = await record(fx.employee.id);
    expect(r.status).toBe('INCOMPLETE');
    expect(r.anomalies).toContain('MISSING_CHECK_OUT');
    expect(await prisma.attendanceEvent.findUnique({ where: { id: exit.id } })).toMatchObject({
      voidReason: 'Marcación errónea',
    });
  });

  it('turns an absence into ON_LEAVE when a full-day leave is approved', async () => {
    await http()
      .post('/api/attendance/recompute')
      .set(bearer(hr))
      .send({ from: WORK_DATE, to: WORK_DATE, employeeId: fx.teammate.id })
      .expect(201);
    expect((await record(fx.teammate.id)).status).toBe('ABSENT');

    const employeeToken = await login(app, fx.emails.employee);
    // Employees can only request leave for themselves.
    await http()
      .post('/api/leave-requests')
      .set(bearer(employeeToken))
      .send({
        employeeId: fx.teammate.id,
        type: 'MEDICAL',
        startsAt: at('00:00'),
        endsAt: at('23:59'),
        reason: 'not mine',
      })
      .expect(403);

    const created = await http()
      .post('/api/leave-requests')
      .set(bearer(hr))
      .send({
        employeeId: fx.teammate.id,
        type: 'MEDICAL',
        startsAt: at('00:00'),
        endsAt: at('23:59'),
        reason: 'Cita médica',
      })
      .expect(201);

    const supervisor = await login(app, fx.emails.supervisor);
    await http()
      .post(`/api/leave-requests/${created.body.id}/review`)
      .set(bearer(supervisor))
      .send({ decision: 'APPROVED' })
      .expect(201);
    expect((await record(fx.teammate.id)).status).toBe('ON_LEAVE');

    // A decided request cannot be reviewed again.
    await http()
      .post(`/api/leave-requests/${created.body.id}/review`)
      .set(bearer(supervisor))
      .send({ decision: 'REJECTED' })
      .expect(409);
  });

  it('proposes overtime that must be approved by someone else', async () => {
    for (const t of ['08:00', '19:00']) await manual(fx.teammate.id, t).expect(201);
    const overtime = await prisma.overtimeRecord.findFirstOrThrow({
      where: { employeeId: fx.teammate.id },
    });
    expect(overtime).toMatchObject({ status: 'PENDING', minutes: 120, kind: 'REGULAR' });

    await http()
      .post(`/api/overtime/${overtime.id}/review`)
      .set(bearer(hr))
      .send({ decision: 'APPROVED', note: 'Inventario' })
      .expect(201);
    const list = await http().get('/api/overtime?status=APPROVED').set(bearer(hr)).expect(200);
    expect(list.body.totalMinutes).toBeGreaterThanOrEqual(120);
  });

  it('lets an employee see only their own attendance', async () => {
    const token = await login(app, fx.emails.employee);
    const res = await http()
      .get(`/api/attendance/records?from=${WORK_DATE}&to=${WORK_DATE}&pageSize=100`)
      .set(bearer(token))
      .expect(200);
    expect(
      res.body.data.every((r: { employeeId: string }) => r.employeeId === fx.employee.id),
    ).toBe(true);
    await http()
      .get(`/api/attendance/events?from=${WORK_DATE}&to=${WORK_DATE}&unmatched=true`)
      .set(bearer(token))
      .expect(400);
  });

  it('exports a spreadsheet-safe CSV report', async () => {
    const res = await http()
      .get(`/api/reports/daily?from=${WORK_DATE}&format=csv`)
      .set(bearer(hr))
      .expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain(`asistcontrol-daily-${WORK_DATE}`);
    expect(res.text.startsWith('\uFEFFfecha,codigo,empleado')).toBe(true);
    expect(res.text).toContain(`${fx.tag}Last2`);
  });

  it('rejects unknown report kinds and oversized ranges', async () => {
    await http().get(`/api/reports/salaries?from=${WORK_DATE}`).set(bearer(hr)).expect(400);
    await http()
      .get('/api/reports/daily?from=2026-01-01&to=2026-12-31')
      .set(bearer(hr))
      .expect(400);
  });

  describe('manual corrections with preview', () => {
    const DAY = '2026-09-15';
    const recordOn = async (employeeId: string, date: string) =>
      (
        await http()
          .get(`/api/attendance/records?from=${date}&to=${date}&employeeId=${employeeId}`)
          .set(bearer(hr))
          .expect(200)
      ).body.data[0];
    const batch = (punches: { occurredAt: string; punchType?: string }[], date = DAY) =>
      http()
        .post('/api/attendance/events/batch')
        .set(bearer(hr))
        .send({ employeeId: fx.teammate.id, punches, reason: `No marcó el ${date} (e2e)` });

    it('previews a forgotten exit without saving it', async () => {
      await http()
        .post('/api/attendance/events')
        .set(bearer(hr))
        .send({ employeeId: fx.employee.id, occurredAt: at('08:03', DAY), reason: 'Entrada (e2e)' })
        .expect(201);

      const res = await http()
        .post('/api/attendance/events/preview')
        .set(bearer(hr))
        .send({ employeeId: fx.employee.id, punches: [{ occurredAt: at('17:00', DAY) }] })
        .expect(200);

      expect(res.body).toMatchObject({
        workDate: DAY,
        dayType: 'WORKDAY',
        employed: true,
        punchPairing: 'SEQUENTIAL',
        shift: { start: at('08:00', DAY), end: at('17:00', DAY) },
        before: { status: 'INCOMPLETE' },
        // 08:03 → 17:00 minus the scheduled lunch nobody punched.
        after: { status: 'PRESENT', workedMinutes: 477 },
      });
      expect(
        res.body.punches.map((p: { reading: string; proposed: boolean }) => [
          p.reading,
          p.proposed,
        ]),
      ).toEqual([
        ['CHECK_IN', false],
        ['CHECK_OUT', true],
      ]);
      expect(
        await prisma.attendanceEvent.count({
          where: { employeeId: fx.employee.id, occurredAt: { gte: new Date(at('00:00', DAY)) } },
        }),
      ).toBe(1);
    });

    it('registers a whole forgotten day at once and audits each punch', async () => {
      const res = await batch([
        { occurredAt: at('08:00', DAY), punchType: 'CHECK_IN' },
        { occurredAt: at('17:00', DAY), punchType: 'CHECK_OUT' },
      ]).expect(201);

      expect(res.body).toHaveLength(2);
      expect(await recordOn(fx.teammate.id, DAY)).toMatchObject({
        status: 'PRESENT',
        workedMinutes: 480,
      });
      expect(
        await prisma.auditLog.count({
          where: {
            action: 'attendance.manual_event',
            entityId: { in: res.body.map((e: { id: string }) => e.id) },
          },
        }),
      ).toBe(2);
    });

    it('saves none of the punches when one of them is wrong', async () => {
      const DAY2 = '2026-09-16';
      const before = await prisma.attendanceEvent.count({ where: { employeeId: fx.teammate.id } });

      await batch([{ occurredAt: at('08:00', DAY) }, { occurredAt: at('12:00', DAY2) }]).expect(
        409,
      );
      await batch([{ occurredAt: at('08:00', DAY2) }, { occurredAt: at('08:00', DAY2) }]).expect(
        400,
      );
      await batch([
        { occurredAt: at('08:00', DAY2) },
        { occurredAt: new Date(Date.now() + 3_600_000).toISOString() },
      ]).expect(400);
      await batch([1, 2, 3, 4, 5].map((h) => ({ occurredAt: at(`0${h}:00`, DAY2) }))).expect(400);

      expect(await prisma.attendanceEvent.count({ where: { employeeId: fx.teammate.id } })).toBe(
        before,
      );
    });

    it('lets only those who can correct attendance preview it', async () => {
      const supervisor = await login(app, fx.emails.supervisor);
      await http()
        .post('/api/attendance/events/preview')
        .set(bearer(supervisor))
        .send({ employeeId: fx.employee.id, punches: [{ occurredAt: at('17:00', DAY) }] })
        .expect(403);
    });
  });

  describe('punches outside every work day', () => {
    // The fixture shift runs 08:00-17:00; with the default policy its window closes at 23:00.
    const DAY = '2026-09-17';

    it('reports a punch after the window without counting it', async () => {
      await http()
        .post('/api/attendance/events/batch')
        .set(bearer(hr))
        .send({
          employeeId: fx.teammate.id,
          punches: ['08:00', '17:00', '23:30'].map((t) => ({ occurredAt: at(t, DAY) })),
          reason: 'Fuera de jornada (e2e)',
        })
        .expect(201);

      const r = (
        await http()
          .get(`/api/attendance/records?from=${DAY}&to=${DAY}&employeeId=${fx.teammate.id}`)
          .set(bearer(hr))
          .expect(200)
      ).body.data[0];
      expect(r).toMatchObject({ status: 'PRESENT', workedMinutes: 480, lastOut: at('17:00', DAY) });
      expect(r.anomalies).toContain('STRAY_PUNCH');
    });

    it('lists the stray in the preview of its day', async () => {
      const res = await http()
        .post('/api/attendance/events/preview')
        .set(bearer(hr))
        .send({ employeeId: fx.teammate.id, punches: [{ occurredAt: at('12:00', DAY) }] })
        .expect(200);
      expect(res.body.before.anomalies).toContain('STRAY_PUNCH');
      const stray = res.body.punches.find(
        (p: { occurredAt: string }) => p.occurredAt === at('23:30', DAY),
      );
      expect(stray).toMatchObject({ proposed: false, reading: 'OTHER_DAY' });
    });
  });
});
