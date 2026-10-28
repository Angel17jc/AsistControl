import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { PresenceService } from '../src/attendance/presence.service';
import type { AuthenticatedUser } from '../src/common/auth/authenticated-user';
import { at, bearer, createApp, createFixture, type Fixture, login } from './utils';

const DAY = '2026-09-18';

describe('Presence board (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let fx: Fixture;
  let hr: string;
  const http = () => request(app.getHttpServer());

  /** The board is about "now": the service takes the moment, so the test fixes it. */
  const boardAt = async (email: string, hhmm: string) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const actor: AuthenticatedUser = {
      id: user.id,
      email,
      role: user.role,
      employeeId: user.employeeId,
      sessionId: 'e2e',
      mustChangePassword: false,
    };
    const board = await app.get(PresenceService).board(actor, new Date(at(hhmm, DAY)));
    return { board, of: (id: string) => board.entries.find((e) => e.employee.id === id) };
  };

  beforeAll(async () => {
    app = await createApp();
    prisma = new PrismaClient();
    fx = await createFixture(prisma, 'prs');
    hr = await login(app, fx.emails.hr);
    const punch = (employeeId: string, times: string[]) =>
      http()
        .post('/api/attendance/events/batch')
        .set(bearer(hr))
        .send({
          employeeId,
          punches: times.map((t) => ({ occurredAt: at(t, DAY) })),
          reason: 'Presencia (e2e)',
        })
        .expect(201);
    await punch(fx.employee.id, ['08:02']);
    await punch(fx.teammate.id, ['08:00', '12:01']);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('tells who is in, at lunch and not arrived at a given moment', async () => {
    const { board, of } = await boardAt(fx.emails.supervisor, '12:30');

    expect(of(fx.employee.id)).toMatchObject({
      state: 'IN',
      workDate: DAY,
      firstIn: at('08:02', DAY),
      lateMinutes: 0,
      lastPunch: { at: at('08:02', DAY), reading: 'CHECK_IN', deviceName: null },
      shift: { start: at('08:00', DAY), end: at('17:00', DAY) },
    });
    expect(of(fx.teammate.id)).toMatchObject({ state: 'ON_BREAK', leaveType: null });
    expect(of(fx.supervisor.id)).toMatchObject({
      state: 'NOT_ARRIVED',
      expectedStart: at('08:00', DAY),
      lastPunch: null,
    });
    // The supervisor sees their team, in board order.
    expect(board.entries.map((e) => e.state)).toEqual(['IN', 'ON_BREAK', 'NOT_ARRIVED']);
    expect(board.counts).toMatchObject({ IN: 1, ON_BREAK: 1, NOT_ARRIVED: 1, LEFT: 0 });
  });

  it('ignores the punches that have not happened yet', async () => {
    const { board } = await boardAt(fx.emails.supervisor, '07:30');
    expect(board.entries.map((e) => e.state)).toEqual(['NOT_YET', 'NOT_YET', 'NOT_YET']);
  });

  it('shows approved leave covering the moment', async () => {
    await prisma.leaveRequest.create({
      data: {
        employeeId: fx.supervisor.id,
        type: 'MEDICAL',
        status: 'APPROVED',
        startsAt: new Date(at('00:00', DAY)),
        endsAt: new Date(at('23:59', DAY)),
        reason: 'Cita médica (e2e)',
        requestedById: (await prisma.user.findUniqueOrThrow({ where: { email: fx.emails.hr } })).id,
      },
    });
    const { of } = await boardAt(fx.emails.supervisor, '12:30');
    expect(of(fx.supervisor.id)).toMatchObject({ state: 'ON_LEAVE', leaveType: 'MEDICAL' });
  });

  it('is served to those who watch attendance, scoped by role', async () => {
    const all = await http().get('/api/attendance/presence').set(bearer(hr)).expect(200);
    const ids = all.body.entries.map((e: { employee: { id: string } }) => e.employee.id);
    expect(ids).toEqual(expect.arrayContaining([fx.employee.id, fx.teammate.id, fx.supervisor.id]));

    const supervisor = await login(app, fx.emails.supervisor);
    const team = await http().get('/api/attendance/presence').set(bearer(supervisor)).expect(200);
    expect(team.body.entries).toHaveLength(3);

    const employee = await login(app, fx.emails.employee);
    await http().get('/api/attendance/presence').set(bearer(employee)).expect(403);
  });
});
