import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { WORK_DATE, bearer, createApp, createFixture, type Fixture, login } from './utils';

/**
 * Full path Device → Adapter → Pipeline → Database → Attendance, driven through the public
 * API with the mock terminal — exactly what a real LAN device would go through.
 */
describe('Device sync pipeline (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let fx: Fixture;
  let admin: string;
  let deviceId: string;
  const http = () => request(app.getHttpServer());

  const sync = async () =>
    (await http().post(`/api/devices/${deviceId}/sync`).set(bearer(admin)).expect(200)).body;
  const faults = (body: object) =>
    http()
      .post(`/api/devices/${deviceId}/simulate/faults`)
      .set(bearer(admin))
      .send(body)
      .expect(201);
  const recordOf = async (employeeId: string) =>
    (
      await http()
        .get(`/api/attendance/records?from=${WORK_DATE}&to=${WORK_DATE}&employeeId=${employeeId}`)
        .set(bearer(admin))
        .expect(200)
    ).body.data[0];

  beforeAll(async () => {
    app = await createApp();
    prisma = new PrismaClient();
    fx = await createFixture(prisma, 'sync');
    admin = await login(app, fx.emails.admin);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('registers a MOCK device without ever exposing its credentials', async () => {
    const res = await http()
      .post('/api/devices')
      .set(bearer(admin))
      .send({
        name: 'E2E Terminal',
        driver: 'MOCK',
        manufacturer: 'AsistControl',
        model: 'SIM',
        host: '10.10.10.10',
        port: 4370,
        config: { realtime: false, timeoutMs: 1000 },
        credentials: { commKey: 'super-secret-123' },
      })
      .expect(201);
    deviceId = res.body.id;
    expect(res.body.hasCredentials).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('super-secret-123');
    expect(res.body).not.toHaveProperty('credentialsEncrypted');

    const stored = await prisma.device.findUniqueOrThrow({ where: { id: deviceId } });
    expect(stored.credentialsEncrypted).toMatch(/^v1\./);
    expect(stored.credentialsEncrypted).not.toContain('super-secret-123');
  });

  it('refuses a second device on the same address', async () => {
    await http()
      .post('/api/devices')
      .set(bearer(admin))
      .send({
        name: 'Clone',
        driver: 'MOCK',
        manufacturer: 'X',
        model: 'Y',
        host: '10.10.10.10',
        port: 4370,
      })
      .expect(409);
  });

  it('tests the connection and marks the device ONLINE', async () => {
    const res = await http()
      .post(`/api/devices/${deviceId}/test-connection`)
      .set(bearer(admin))
      .expect(200);
    expect(res.body).toMatchObject({ reachable: true, error: null });
    expect((await prisma.device.findUniqueOrThrow({ where: { id: deviceId } })).status).toBe(
      'ONLINE',
    );
  });

  it('downloads a late work day and computes the attendance record', async () => {
    await http()
      .post(`/api/devices/${deviceId}/simulate/workday`)
      .set(bearer(admin))
      .send({ date: WORK_DATE, scenario: 'LATE', employeeIds: [fx.employee.id] })
      .expect(201);

    const log = await sync();
    expect(log).toMatchObject({
      status: 'SUCCESS',
      recordsReceived: 4,
      recordsProcessed: 4,
      recordsDuplicated: 0,
      recordsRejected: 0,
    });

    const record = await recordOf(fx.employee.id);
    expect(record.status).toBe('LATE');
    expect(record.lateMinutes).toBeGreaterThanOrEqual(12);
    expect(record.isFinal).toBe(true);
    expect(record.anomalies).toContain('LATE_ARRIVAL');
  });

  it('is idempotent: syncing again stores nothing new', async () => {
    const before = await prisma.attendanceEvent.count({ where: { deviceId } });
    const log = await sync();
    expect(log.recordsProcessed).toBe(0);
    expect(await prisma.attendanceEvent.count({ where: { deviceId } })).toBe(before);
  });

  it('counts duplicates sent by faulty firmware without storing them twice', async () => {
    await faults({ duplicateOnRead: true });
    await http()
      .post(`/api/devices/${deviceId}/simulate/workday`)
      .set(bearer(admin))
      .send({ date: WORK_DATE, scenario: 'ON_TIME', employeeIds: [fx.teammate.id] })
      .expect(201);
    const log = await sync();
    expect(log).toMatchObject({ recordsReceived: 8, recordsProcessed: 4, recordsDuplicated: 4 });
    expect((await recordOf(fx.teammate.id)).status).toBe('PRESENT');
    await faults({ reset: true });
  });

  it('keeps unknown biometric ids as unmatched and links them when the employee is enrolled', async () => {
    await http()
      .post(`/api/devices/${deviceId}/simulate/punch`)
      .set(bearer(admin))
      .send({ deviceUserId: 'sync77' })
      .expect(201);
    const log = await sync();
    expect(log.recordsUnmatched).toBe(1);

    const hr = await login(app, fx.emails.hr);
    const created = await http()
      .post('/api/employees')
      .set(bearer(hr))
      .send({
        employeeCode: 'SYNC-77',
        identification: 'sync770000',
        firstName: 'Late',
        lastName: 'Enrolled',
        hireDate: '2026-01-01',
        biometricId: 'sync77',
      })
      .expect(201);
    const linked = await prisma.attendanceEvent.count({
      where: { deviceUserId: 'sync77', employeeId: created.body.id },
    });
    expect(linked).toBe(1);
  });

  it('marks the device OFFLINE and logs a FAILED sync when it is unreachable', async () => {
    await faults({ online: false });
    const log = await sync();
    expect(log.status).toBe('FAILED');
    expect(log.errorMessage).toMatch(/CONNECTION_FAILED/);
    const device = await prisma.device.findUniqueOrThrow({ where: { id: deviceId } });
    expect(device.status).toBe('OFFLINE');
    expect(device.syncLockedAt).toBeNull();
  });

  it('recovers punches stored while offline on the next successful sync', async () => {
    await http()
      .post(`/api/devices/${deviceId}/simulate/punch`)
      .set(bearer(admin))
      .send({ employeeId: fx.employee.id })
      .expect(201);
    await faults({ reset: true });
    const log = await sync();
    expect(log).toMatchObject({ status: 'SUCCESS', recordsProcessed: 1 });
    expect((await prisma.device.findUniqueOrThrow({ where: { id: deviceId } })).status).toBe(
      'ONLINE',
    );
  });

  it('retries transient timeouts instead of failing the sync', async () => {
    await faults({ failNext: 'TIMEOUT' });
    const log = await sync();
    expect(log.status).toBe('SUCCESS');
  });

  it('rejects a concurrent sync of the same device', async () => {
    await faults({ latencyMs: 300 });
    const [a, b] = await Promise.all([
      http().post(`/api/devices/${deviceId}/sync`).set(bearer(admin)),
      http().post(`/api/devices/${deviceId}/sync`).set(bearer(admin)),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    await faults({ reset: true });
  });

  it('records the history in sync logs and the audit trail', async () => {
    const logs = await http()
      .get(`/api/devices/${deviceId}/sync-logs?pageSize=50`)
      .set(bearer(admin))
      .expect(200);
    expect(logs.body.meta.total).toBeGreaterThanOrEqual(7);
    expect(
      await prisma.auditLog.count({ where: { action: 'device.sync', entityId: deviceId } }),
    ).toBeGreaterThanOrEqual(7);
  });
});
