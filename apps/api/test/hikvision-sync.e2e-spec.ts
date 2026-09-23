import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import { ACS_MINOR, FakeHikvisionDevice } from '@asistcontrol/biometric-core';
import request from 'supertest';
import { WORK_DATE, bearer, createApp, createFixture, type Fixture, login } from './utils';

/**
 * The Hikvision driver end to end: a fake terminal speaking ISAPI (HTTP + Digest) is
 * registered as a device and its events travel through the sync pipeline into attendance.
 */
describe('Hikvision device sync (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let fx: Fixture;
  let admin: string;
  let device: FakeHikvisionDevice;
  let deviceId: string;
  const http = () => request(app.getHttpServer());
  const sync = () => http().post(`/api/devices/${deviceId}/sync`).set(bearer(admin)).expect(200);

  beforeAll(async () => {
    app = await createApp();
    prisma = new PrismaClient();
    fx = await createFixture(prisma, 'hik');
    admin = await login(app, fx.emails.admin);

    device = new FakeHikvisionDevice({
      // A fixed clock keeps the lookback window independent of the day the suite runs.
      deviceTime: `${WORK_DATE}T18:00:00-05:00`,
      events: [
        {
          serialNo: 501,
          employeeNo: fx.employee.biometricId,
          time: `${WORK_DATE}T08:03:00-05:00`,
          attendanceStatus: 'checkIn',
        },
        {
          serialNo: 502,
          employeeNo: fx.employee.biometricId,
          time: `${WORK_DATE}T17:30:00-05:00`,
          minor: ACS_MINOR.FINGERPRINT_PASSED,
          attendanceStatus: 'checkOut',
        },
      ],
    });
    const port = await device.listen();

    const created = await http()
      .post('/api/devices')
      .set(bearer(admin))
      .send({
        name: 'Terminal Hikvision',
        driver: 'HIKVISION',
        manufacturer: 'Hikvision',
        model: 'DS-K1T671M',
        host: '127.0.0.1',
        port,
        config: { timeoutMs: 2000, timezone: 'America/Guayaquil', protocol: 'http' },
        credentials: { username: 'admin', password: 'Hik12345!' },
      })
      .expect(201);
    deviceId = created.body.id;
  });

  afterAll(async () => {
    await device.close();
    await prisma.$disconnect();
    await app.close();
  });

  it('exposes HIKVISION as an available driver', async () => {
    const res = await http().get('/api/devices/drivers').set(bearer(admin)).expect(200);
    expect(res.body).toContain('HIKVISION');
  });

  it('keeps the ISAPI password encrypted and out of every response', async () => {
    const res = await http().get(`/api/devices/${deviceId}`).set(bearer(admin)).expect(200);
    expect(res.body.hasCredentials).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('Hik12345!');

    const row = await prisma.device.findUniqueOrThrow({ where: { id: deviceId } });
    expect(row.credentialsEncrypted).toBeTruthy();
    expect(row.credentialsEncrypted).not.toContain('Hik12345!');
  });

  it('probes the terminal and reads its identity', async () => {
    const res = await http()
      .post(`/api/devices/${deviceId}/test-connection`)
      .set(bearer(admin))
      .expect(200);
    expect(res.body).toMatchObject({ reachable: true, error: null });
    expect(res.body.info).toMatchObject({ manufacturer: 'Hikvision', model: 'DS-K1T671M' });
  });

  it('downloads events and turns them into an attendance record', async () => {
    expect((await sync()).body).toMatchObject({
      status: 'SUCCESS',
      recordsReceived: 2,
      recordsProcessed: 2,
    });

    const records = await http()
      .get(`/api/attendance/records?from=${WORK_DATE}&to=${WORK_DATE}&employeeId=${fx.employee.id}`)
      .set(bearer(admin))
      .expect(200);
    // Same day as the ZKTeco suite: 08:03 → 17:30 local, minus the unpunched lunch break.
    expect(records.body.data[0]).toMatchObject({
      status: 'PRESENT',
      workedMinutes: 507,
      overtimeMinutes: 30,
    });

    const events = await http()
      .get(`/api/attendance/events?from=${WORK_DATE}&to=${WORK_DATE}&employeeId=${fx.employee.id}`)
      .set(bearer(admin))
      .expect(200);
    expect(events.body.data.map((e: { verifyMode: string }) => e.verifyMode).sort()).toEqual([
      'FACE',
      'FINGERPRINT',
    ]);
  });

  it('is incremental: a second sync brings nothing and a new punch brings one', async () => {
    expect((await sync()).body).toMatchObject({ recordsReceived: 0, recordsProcessed: 0 });

    device.options.events = [
      ...device.options.events!,
      {
        serialNo: 503,
        employeeNo: fx.teammate.biometricId,
        time: `${WORK_DATE}T17:45:00-05:00`,
        attendanceStatus: 'checkOut',
      },
    ];
    expect((await sync()).body).toMatchObject({ recordsReceived: 1, recordsProcessed: 1 });
  });

  it('stops after one rejected password instead of locking the terminal account', async () => {
    await http()
      .patch(`/api/devices/${deviceId}`)
      .set(bearer(admin))
      .send({ credentials: { username: 'admin', password: 'wrong-password' } })
      .expect(200);
    const before = device.requests.length;

    const log = await sync();
    expect(log.body.status).toBe('FAILED');
    expect(log.body.errorMessage).toMatch(/AUTHENTICATION_FAILED/);
    // The challenge and a single attempt: the sync retry policy does not retry bad credentials.
    expect(device.requests.length - before).toBe(2);
    // Not OFFLINE: the terminal answered, the configuration is what is wrong.
    expect((await prisma.device.findUniqueOrThrow({ where: { id: deviceId } })).status).toBe(
      'ERROR',
    );
  });

  it('marks the device OFFLINE when the terminal stops answering', async () => {
    await http()
      .patch(`/api/devices/${deviceId}`)
      .set(bearer(admin))
      .send({ credentials: { username: 'admin', password: 'Hik12345!' } })
      .expect(200);
    await device.close();

    const log = await sync();
    expect(log.body.status).toBe('FAILED');
    expect((await prisma.device.findUniqueOrThrow({ where: { id: deviceId } })).status).toBe(
      'OFFLINE',
    );
  });
});
