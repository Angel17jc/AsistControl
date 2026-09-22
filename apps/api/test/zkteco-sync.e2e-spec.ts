import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import { FakeZkDevice } from '@asistcontrol/biometric-core';
import request from 'supertest';
import { WORK_DATE, bearer, createApp, createFixture, type Fixture, login } from './utils';

/**
 * The ZKTeco driver end to end: a fake terminal speaking the real protocol is registered as a
 * device and its records travel through the sync pipeline into attendance records.
 */
describe('ZKTeco device sync (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let fx: Fixture;
  let admin: string;
  let device: FakeZkDevice;
  let deviceId: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
    prisma = new PrismaClient();
    fx = await createFixture(prisma, 'zk');
    admin = await login(app, fx.emails.admin);

    device = new FakeZkDevice({
      serialNumber: 'ZK-E2E-0001',
      model: 'K40',
      records: [
        {
          uid: 1,
          userId: fx.employee.biometricId,
          status: 1,
          punch: 0,
          time: { year: 2026, month: 9, day: 14, hour: 8, minute: 3, second: 0 },
        },
        {
          uid: 1,
          userId: fx.employee.biometricId,
          status: 1,
          punch: 1,
          time: { year: 2026, month: 9, day: 14, hour: 17, minute: 30, second: 0 },
        },
      ],
    });
    const port = await device.listen();

    const created = await http()
      .post('/api/devices')
      .set(bearer(admin))
      .send({
        name: 'Terminal ZKTeco',
        driver: 'ZKTECO',
        manufacturer: 'ZKTeco',
        model: 'K40',
        host: '127.0.0.1',
        port,
        config: { timeoutMs: 2000, timezone: 'America/Guayaquil' },
      })
      .expect(201);
    deviceId = created.body.id;
  });

  afterAll(async () => {
    await device.close();
    await prisma.$disconnect();
    await app.close();
  });

  it('exposes ZKTECO as an available driver', async () => {
    const res = await http().get('/api/devices/drivers').set(bearer(admin)).expect(200);
    expect(res.body).toContain('ZKTECO');
  });

  it('probes the terminal and reads its identity', async () => {
    const res = await http()
      .post(`/api/devices/${deviceId}/test-connection`)
      .set(bearer(admin))
      .expect(200);
    expect(res.body).toMatchObject({ reachable: true, error: null });
    expect(res.body.info).toMatchObject({ manufacturer: 'ZKTeco', serialNumber: 'ZK-E2E-0001' });
  });

  it('downloads records and turns them into an attendance record', async () => {
    const log = await http().post(`/api/devices/${deviceId}/sync`).set(bearer(admin)).expect(200);
    expect(log.body).toMatchObject({ status: 'SUCCESS', recordsReceived: 2, recordsProcessed: 2 });

    const records = await http()
      .get(`/api/attendance/records?from=${WORK_DATE}&to=${WORK_DATE}&employeeId=${fx.employee.id}`)
      .set(bearer(admin))
      .expect(200);
    // 08:03 → 17:30 local, minus the unpunched lunch break.
    expect(records.body.data[0]).toMatchObject({
      status: 'PRESENT',
      workedMinutes: 507,
      overtimeMinutes: 30,
    });
  });

  it('is incremental: a second sync brings nothing and a new punch brings one', async () => {
    expect(
      (await http().post(`/api/devices/${deviceId}/sync`).set(bearer(admin)).expect(200)).body,
    ).toMatchObject({
      recordsReceived: 0,
      recordsProcessed: 0,
    });

    device.options.records = [
      ...device.options.records!,
      {
        uid: 1,
        userId: fx.employee.biometricId,
        status: 1,
        punch: 0,
        time: { year: 2026, month: 9, day: 15, hour: 8, minute: 0, second: 0 },
      },
    ];
    expect(
      (await http().post(`/api/devices/${deviceId}/sync`).set(bearer(admin)).expect(200)).body,
    ).toMatchObject({
      recordsReceived: 1,
      recordsProcessed: 1,
    });
  });

  it('marks the device OFFLINE when the terminal stops answering', async () => {
    await device.close();
    const log = await http().post(`/api/devices/${deviceId}/sync`).set(bearer(admin)).expect(200);
    expect(log.body.status).toBe('FAILED');
    expect((await prisma.device.findUniqueOrThrow({ where: { id: deviceId } })).status).toBe(
      'OFFLINE',
    );
  });
});
