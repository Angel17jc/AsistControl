import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient, type Role } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

export const PASSWORD = 'E2eTestPassword2026';
/** A past Monday: every work window is closed, so results are final and deterministic. */
export const WORK_DATE = '2026-09-14';
export const TZ_OFFSET = '-05:00';

export async function createApp(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

export interface Fixture {
  tag: string;
  employee: { id: string; biometricId: string };
  teammate: { id: string; biometricId: string };
  supervisor: { id: string };
  emails: Record<'admin' | 'hr' | 'supervisor' | 'employee', string>;
}

/**
 * Creates an isolated organization slice (unique per test file) with a 7-day 08:00-17:00
 * schedule, so tests do not depend on the weekday they run.
 */
export async function createFixture(prisma: PrismaClient, tag: string): Promise<Fixture> {
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  const shift = await prisma.workShift.create({
    data: {
      name: `Office ${tag}`,
      startTime: '08:00',
      endTime: '17:00',
      breakStart: '12:00',
      breakEnd: '13:00',
    },
  });
  const schedule = await prisma.workSchedule.create({
    data: {
      name: `Every day ${tag}`,
      days: { create: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, shiftId: shift.id })) },
    },
  });

  const mk = (n: number, supervisorId?: string) =>
    prisma.employee.create({
      data: {
        employeeCode: `${tag}-${n}`.toUpperCase(),
        identification: `${tag}${n}0000`,
        firstName: `Name${n}`,
        lastName: `${tag}Last${n}`,
        hireDate: new Date('2026-01-01T00:00:00Z'),
        biometricId: `${tag}${n}`,
        supervisorId,
        scheduleAssignments: {
          create: { scheduleId: schedule.id, effectiveFrom: new Date('2026-01-01T00:00:00Z') },
        },
      },
    });
  const supervisor = await mk(1);
  const employee = await mk(2, supervisor.id);
  const teammate = await mk(3, supervisor.id);

  const emails = {
    admin: `admin-${tag}@e2e.local`,
    hr: `hr-${tag}@e2e.local`,
    supervisor: `sup-${tag}@e2e.local`,
    employee: `emp-${tag}@e2e.local`,
  };
  const users: [string, Role, string | undefined][] = [
    [emails.admin, 'SUPER_ADMIN', undefined],
    [emails.hr, 'HR', undefined],
    [emails.supervisor, 'SUPERVISOR', supervisor.id],
    [emails.employee, 'EMPLOYEE', employee.id],
  ];
  for (const [email, role, employeeId] of users) {
    await prisma.user.create({ data: { email, role, passwordHash, employeeId } });
  }

  return {
    tag,
    employee: { id: employee.id, biometricId: employee.biometricId! },
    teammate: { id: teammate.id, biometricId: teammate.biometricId! },
    supervisor: { id: supervisor.id },
    emails,
  };
}

export async function login(app: NestExpressApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return res.body.accessToken as string;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * Waits for a write the API makes in the background (fire-and-forget audit entries) instead
 * of sleeping a fixed time, which fails on a slow CI runner. Resolves with the last value.
 */
export async function eventually<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 5_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    value = await read();
  }
  return value;
}

/** Local wall-clock time on WORK_DATE as ISO instant. */
export const at = (hhmm: string, date = WORK_DATE) =>
  new Date(`${date}T${hhmm}:00${TZ_OFFSET}`).toISOString();
