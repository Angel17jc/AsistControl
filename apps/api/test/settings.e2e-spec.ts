import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { bearer, createApp, createFixture, type Fixture, login } from './utils';

/**
 * The attendance policy is validated with zod at runtime, so a bad value must come back as a
 * 400 naming the offending field instead of silently corrupting how days are calculated.
 */
describe('Attendance policy settings (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let fx: Fixture;
  let admin: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
    prisma = new PrismaClient();
    fx = await createFixture(prisma, 'set');
    admin = await login(app, fx.emails.admin);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('returns the timezone and the policy in force', async () => {
    const res = await http().get('/api/settings').set(bearer(admin)).expect(200);
    expect(res.body).toMatchObject({
      timezone: 'America/Guayaquil',
      attendancePolicy: { lateToleranceMinutes: 5, punchPairing: 'SEQUENTIAL' },
    });
  });

  it('applies a partial update and keeps the rest of the policy', async () => {
    const res = await http()
      .patch('/api/settings/attendance-policy')
      .set(bearer(admin))
      .send({ lateToleranceMinutes: 10, overtimeBasis: 'EXCESS_WORKED_TIME' })
      .expect(200);
    expect(res.body).toMatchObject({
      lateToleranceMinutes: 10,
      overtimeBasis: 'EXCESS_WORKED_TIME',
      duplicatePunchWindowSeconds: 60,
    });
    await http()
      .patch('/api/settings/attendance-policy')
      .set(bearer(admin))
      .send({ lateToleranceMinutes: 5, overtimeBasis: 'AFTER_SHIFT_END' })
      .expect(200);
  });

  it.each([
    ['out of range', { lateToleranceMinutes: 9999 }],
    ['wrong type', { autoDeductUnpunchedBreak: 'yes' }],
    ['unknown option', { overtimeBasis: 'WHATEVER' }],
  ])('rejects a policy with a %s value naming the field', async (_case, patch) => {
    const res = await http()
      .patch('/api/settings/attendance-policy')
      .set(bearer(admin))
      .send(patch)
      .expect(400);
    expect(String(res.body.message)).toContain(Object.keys(patch)[0]!);
  });

  it('is only editable with settings:write', async () => {
    const hr = await login(app, fx.emails.hr);
    await http().get('/api/settings').set(bearer(hr)).expect(200);
    await http()
      .patch('/api/settings/attendance-policy')
      .set(bearer(hr))
      .send({ lateToleranceMinutes: 30 })
      .expect(403);
  });
});
