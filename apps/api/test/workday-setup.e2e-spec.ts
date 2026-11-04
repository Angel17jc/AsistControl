import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { at, bearer, createApp, createFixture, type Fixture, login } from './utils';

/** A small company configures itself in one step, and new people land on the same workday. */
describe('Quick setup of the workday (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let fx: Fixture;
  let hr: string;
  let admin: string;
  const http = () => request(app.getHttpServer());
  const NEAR_PAST = (() => {
    const d = new Date(Date.now() - 20 * 86_400_000);
    return d.toISOString().slice(0, 10);
  })();
  const WORKDAY = {
    dailyMinutes: 480,
    lunchMinutes: 60,
    weekdays: [1, 2, 3, 4, 5],
    effectiveFrom: NEAR_PAST,
    overtimeEnabled: false,
  };
  const setup = (body: object, token = admin) =>
    http().post('/api/work-schedules/setup').set(bearer(token)).send(body);
  const currentAssignment = (employeeId: string) =>
    prisma.employeeSchedule.findFirst({
      where: { employeeId, effectiveTo: null },
      include: { schedule: { include: { days: { include: { shift: true } } } } },
    });

  beforeAll(async () => {
    app = await createApp();
    prisma = new PrismaClient();
    fx = await createFixture(prisma, 'wks');
    hr = await login(app, fx.emails.hr);
    admin = await login(app, fx.emails.admin);
  });

  afterAll(async () => {
    await http()
      .patch('/api/settings/attendance-policy')
      .set(bearer(admin))
      .send({ overtimeEnabled: true })
      .expect(200);
    await prisma.employeeSchedule.deleteMany({
      where: { schedule: { name: 'Jornada de la empresa' } },
    });
    await prisma.$disconnect();
    await app.close();
  });

  it('is for whoever can change both the schedules and the rules', async () => {
    await setup(WORKDAY, hr).expect(403);
  });

  it('refuses a date whose days could not be recalculated', async () => {
    const res = await setup({ ...WORKDAY, effectiveFrom: '2020-01-01' }).expect(400);
    expect(res.body).toMatchObject({ code: 'ASSIGNMENT_TOO_OLD', params: { maxDays: 62 } });
  });

  it('refuses a week without working days', async () => {
    const res = await setup({ ...WORKDAY, weekdays: [] }).expect(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('puts everyone on one workday without fixed hours, and turns overtime off', async () => {
    const res = await setup(WORKDAY).expect(201);
    expect(res.body.onSchedule).toBeGreaterThanOrEqual(2);

    const assignment = await currentAssignment(fx.employee.id);
    expect(assignment?.schedule.name).toBe('Jornada de la empresa');
    expect(assignment?.schedule.days.map((d) => d.weekday).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(assignment?.schedule.days[0]?.shift).toMatchObject({
      flexible: true,
      startTime: '08:00',
      endTime: '17:00',
      breakStart: '13:00',
      breakEnd: '14:00',
    });
    const features = await http().get('/api/settings/features').set(bearer(hr)).expect(200);
    expect(features.body).toEqual({ overtimeEnabled: false });
  });

  it('recalculates the days already punched', async () => {
    await http()
      .post('/api/attendance/events/batch')
      .set(bearer(hr))
      .send({
        employeeId: fx.teammate.id,
        punches: ['09:00', '13:00', '14:00', '20:00'].map((t) => ({
          occurredAt: at(t, NEAR_PAST),
        })),
        reason: 'Jornada (e2e)',
      })
      .expect(201);
    await setup(WORKDAY).expect(201);
    const record = await prisma.attendanceRecord.findFirst({
      where: { employeeId: fx.teammate.id, workDate: new Date(`${NEAR_PAST}T00:00:00Z`) },
    });
    expect(record).toMatchObject({ lateMinutes: 0, overtimeMinutes: 0, scheduledStart: null });
  });

  it('runs again with other values for everyone, without a second assignment', async () => {
    const res = await setup({ ...WORKDAY, dailyMinutes: 540, weekdays: [1, 2, 3, 4, 5, 6] }).expect(
      201,
    );
    expect(res.body.assigned).toBe(0);
    const assignments = await prisma.employeeSchedule.count({
      where: { employeeId: fx.employee.id, schedule: { name: 'Jornada de la empresa' } },
    });
    expect(assignments).toBe(1);
    const assignment = await currentAssignment(fx.employee.id);
    expect(assignment?.schedule.days).toHaveLength(6);
    expect(assignment?.schedule.days[0]?.shift.endTime).toBe('18:00');
    await setup(WORKDAY).expect(201);
  });

  it('leaves alone someone whose schedule starts on or after that date', async () => {
    const other = await prisma.workSchedule.create({ data: { name: 'Propio wks' } });
    const employee = await prisma.employee.create({
      data: {
        employeeCode: 'WKS-KEEP',
        identification: 'WKSKEEP01',
        firstName: 'Con',
        lastName: 'Horario',
        hireDate: new Date('2026-01-01'),
        scheduleAssignments: {
          create: { scheduleId: other.id, effectiveFrom: new Date(`${NEAR_PAST}T00:00:00Z`) },
        },
      },
    });
    const res = await setup(WORKDAY).expect(201);
    expect(res.body.kept).toBeGreaterThanOrEqual(1);
    const assignment = await currentAssignment(employee.id);
    expect(assignment?.scheduleId).toBe(other.id);
  });

  it('hires someone on a schedule from their first day', async () => {
    const { id: scheduleId } = await prisma.workSchedule.findUniqueOrThrow({
      where: { name: 'Jornada de la empresa' },
    });
    const res = await http()
      .post('/api/employees')
      .set(bearer(hr))
      .send({
        employeeCode: 'WKS-NEW',
        identification: 'WKSNEW001',
        firstName: 'Nueva',
        lastName: 'Persona',
        hireDate: NEAR_PAST,
        scheduleId,
      })
      .expect(201);
    const assignment = await currentAssignment((res.body as { id: string }).id);
    expect(assignment?.scheduleId).toBe(scheduleId);
    expect(assignment?.effectiveFrom.toISOString().slice(0, 10)).toBe(NEAR_PAST);
  });

  describe('punches that arrive late, like the first download of a terminal', () => {
    const daysBefore = (date: string, days: number) =>
      new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const statusOf = async (employeeId: string, date: string) =>
      (
        await prisma.attendanceRecord.findUnique({
          where: {
            employeeId_workDate: { employeeId, workDate: new Date(`${date}T00:00:00Z`) },
          },
        })
      )?.status;
    const isWeekend = (date: string) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
    const hireWithPunch = async (code: string, date: string) => {
      const { id: scheduleId } = await prisma.workSchedule.findUniqueOrThrow({
        where: { name: 'Jornada de la empresa' },
      });
      const created = await http()
        .post('/api/employees')
        .set(bearer(hr))
        .send({
          employeeCode: code,
          identification: `${code.replace('-', '')}01`,
          firstName: 'Con',
          lastName: 'Historia',
          hireDate: '2026-01-01',
          scheduleId,
        })
        .expect(201);
      const { id } = created.body as { id: string };
      await http()
        .post('/api/attendance/events/batch')
        .set(bearer(hr))
        .send({
          employeeId: id,
          punches: ['08:00', '17:00'].map((t) => ({ occurredAt: at(t, date) })),
          reason: 'Historia (e2e)',
        })
        .expect(201);
      return id;
    };

    it('completes the days nobody punched, as absences or days off', async () => {
      const first = daysBefore(today, 20);
      const id = await hireWithPunch('WKS-HIS', first);
      for (let back = 19; back >= 1; back--) {
        const date = daysBefore(today, back);
        const status = await statusOf(id, date);
        if (isWeekend(date)) expect(status).toBe('REST_DAY');
        else expect(['ABSENT', 'HOLIDAY']).toContain(status);
      }
    });

    it('assumes nothing before the first punch', async () => {
      const first = daysBefore(today, 15);
      const id = await hireWithPunch('WKS-PRE', first);
      expect(await statusOf(id, daysBefore(first, 1))).toBeUndefined();
      expect(await statusOf(id, daysBefore(first, 10))).toBeUndefined();
    });

    it('leaves the finalizer the days of a punch from today', async () => {
      const id = await hireWithPunch('WKS-NOW', today);
      expect(await prisma.attendanceRecord.count({ where: { employeeId: id } })).toBe(1);
    });

    it('does not undo a day already calculated', async () => {
      const first = daysBefore(today, 12);
      const id = await hireWithPunch('WKS-KEP', first);
      const worked = daysBefore(today, 5);
      await http()
        .post('/api/attendance/events/batch')
        .set(bearer(hr))
        .send({
          employeeId: id,
          punches: ['09:00', '18:00'].map((t) => ({ occurredAt: at(t, worked) })),
          reason: 'Historia (e2e)',
        })
        .expect(201);
      // A later correction further back walks over that day again.
      await http()
        .post('/api/attendance/events/batch')
        .set(bearer(hr))
        .send({
          employeeId: id,
          punches: ['09:00', '18:00'].map((t) => ({ occurredAt: at(t, daysBefore(today, 14)) })),
          reason: 'Historia (e2e)',
        })
        .expect(201);
      const record = await prisma.attendanceRecord.findUnique({
        where: {
          employeeId_workDate: { employeeId: id, workDate: new Date(`${worked}T00:00:00Z`) },
        },
      });
      expect(record?.workedMinutes).toBeGreaterThan(0);
    });
  });

  it('refuses a schedule that does not exist, and creates nobody', async () => {
    const res = await http()
      .post('/api/employees')
      .set(bearer(hr))
      .send({
        employeeCode: 'WKS-BAD',
        identification: 'WKSBAD001',
        firstName: 'Mala',
        lastName: 'Referencia',
        hireDate: NEAR_PAST,
        scheduleId: '00000000-0000-4000-8000-000000000000',
      })
      .expect(400);
    expect(res.body).toMatchObject({
      code: 'RELATED_RECORD_NOT_FOUND',
      params: { record: 'schedule' },
    });
    expect(await prisma.employee.count({ where: { employeeCode: 'WKS-BAD' } })).toBe(0);
  });

  it('does not take a schedule when editing: that has its own history', async () => {
    const res = await http()
      .patch(`/api/employees/${fx.employee.id}`)
      .set(bearer(hr))
      .send({ scheduleId: '00000000-0000-4000-8000-000000000000' })
      .expect(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
