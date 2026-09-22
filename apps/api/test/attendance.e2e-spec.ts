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
});
