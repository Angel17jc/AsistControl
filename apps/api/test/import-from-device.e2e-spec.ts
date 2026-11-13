import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { bearer, createApp, createFixture, type Fixture, login } from './utils';

/**
 * Employees from the people already registered on the terminal: the company has ~25 people
 * enrolled with their number and name, and nobody should type them again.
 */
describe('Import from device (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let fx: Fixture;
  let admin: string;
  let hr: string;
  let deviceId: string;
  const http = () => request(app.getHttpServer());

  const enroll = (deviceUserId: string, name: string) =>
    http()
      .post(`/api/devices/${deviceId}/simulate/enroll`)
      .set(bearer(admin))
      .send({ deviceUserId, name })
      .expect(201);
  const people = () => http().get(`/api/devices/${deviceId}/people`).set(bearer(hr));
  const importPeople = (list: { biometricId: string; firstName: string; lastName: string }[]) =>
    http()
      .post('/api/employees/import')
      .set(bearer(hr))
      .send({ people: list, hireDate: '2026-11-01' })
      .expect(201);

  beforeAll(async () => {
    app = await createApp();
    prisma = new PrismaClient();
    fx = await createFixture(prisma, 'imp');
    admin = await login(app, fx.emails.admin);
    hr = await login(app, fx.emails.hr);
    const device = await http()
      .post('/api/devices')
      .set(bearer(admin))
      .send({
        name: 'Marcador importación',
        driver: 'MOCK',
        manufacturer: 'AsistControl',
        model: 'SIM',
        host: '10.10.20.20',
        port: 4370,
        config: { realtime: false, timeoutMs: 1000 },
        credentials: { commKey: 'import-secret-123' },
      })
      .expect(201);
    deviceId = device.body.id;
    await enroll(fx.employee.biometricId, 'YA REGISTRADA');
    await enroll('9101', 'MELANIE ZAMBRANO');
    await enroll('9102', 'PEDRO ALCIVAR');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('reads who is on the terminal and who of them is already an employee', async () => {
    const res = await people().expect(200);
    const byNumber = Object.fromEntries(
      res.body.map((p: { deviceUserId: string }) => [p.deviceUserId, p]),
    );
    expect(byNumber['9101']).toMatchObject({ name: 'MELANIE ZAMBRANO', employee: null });
    expect(byNumber[fx.employee.biometricId].employee).toMatchObject({ id: fx.employee.id });
    const numbers = res.body.map((p: { deviceUserId: string }) => p.deviceUserId);
    expect(numbers.indexOf('9101')).toBeLessThan(numbers.indexOf('9102'));
  });

  it('creates the new ones without cédula, skips who is already there, and can be run again', async () => {
    const first = await importPeople([
      { biometricId: '9101', firstName: 'Melanie', lastName: 'Zambrano' },
      { biometricId: '9102', firstName: 'Pedro', lastName: 'Alcívar' },
      { biometricId: fx.employee.biometricId, firstName: 'Ya', lastName: 'Registrada' },
    ]);
    expect(first.body.created.map((c: { employeeCode: string }) => c.employeeCode)).toEqual([
      'EMP-9101',
      'EMP-9102',
    ]);
    expect(first.body.skipped).toEqual([
      { biometricId: fx.employee.biometricId, reason: 'ALREADY_REGISTERED' },
    ]);
    const melanie = await prisma.employee.findUniqueOrThrow({ where: { biometricId: '9101' } });
    expect(melanie).toMatchObject({
      firstName: 'Melanie',
      lastName: 'Zambrano',
      identification: null,
    });

    const again = await importPeople([
      { biometricId: '9101', firstName: 'Melanie', lastName: 'Zambrano' },
    ]);
    expect(again.body).toEqual({
      created: [],
      skipped: [{ biometricId: '9101', reason: 'ALREADY_REGISTERED' }],
    });
    const listed = await people().expect(200);
    expect(
      listed.body.find((p: { deviceUserId: string }) => p.deviceUserId === '9101').employee,
    ).toMatchObject({ firstName: 'Melanie', employeeCode: 'EMP-9101' });
  });

  it('gives the new employee the punches the terminal sent before', async () => {
    await enroll('9103', 'ANA RUIZ');
    await http()
      .post(`/api/devices/${deviceId}/simulate/punch`)
      .set(bearer(admin))
      .send({ deviceUserId: '9103' })
      .expect(201);
    await http().post(`/api/devices/${deviceId}/sync`).set(bearer(admin)).expect(200);
    expect(
      await prisma.attendanceEvent.count({ where: { deviceUserId: '9103', employeeId: null } }),
    ).toBe(1);

    const res = await importPeople([{ biometricId: '9103', firstName: 'Ana', lastName: 'Ruiz' }]);
    const employeeId = res.body.created[0].employeeId;
    expect(
      await prisma.attendanceEvent.count({ where: { deviceUserId: '9103', employeeId } }),
    ).toBe(1);
  });

  it('refuses a code already in use instead of overwriting anyone', async () => {
    await enroll('9104', 'LUIS CEDENO');
    const res = await importPeople([
      { biometricId: '9104', firstName: 'Luis', lastName: 'Cedeño', employeeCode: 'EMP-9101' },
    ] as never);
    expect(res.body.skipped).toEqual([{ biometricId: '9104', reason: 'CODE_IN_USE' }]);
  });

  it('says why when the terminal does not answer', async () => {
    await http()
      .post(`/api/devices/${deviceId}/simulate/faults`)
      .set(bearer(admin))
      .send({ online: false })
      .expect(201);
    const res = await people().expect(409);
    expect(res.body.code).toBe('DEVICE_READ_FAILED');
    expect(res.body.params.reason).toMatch(/^CONNECTION_FAILED/);
    await http()
      .post(`/api/devices/${deviceId}/simulate/faults`)
      .set(bearer(admin))
      .send({ reset: true })
      .expect(201);
  });

  it('is for whoever registers employees, not for an employee', async () => {
    const employee = await login(app, fx.emails.employee);
    await http().get(`/api/devices/${deviceId}/people`).set(bearer(employee)).expect(403);
    await http()
      .post('/api/employees/import')
      .set(bearer(employee))
      .send({
        people: [{ biometricId: '1', firstName: 'A', lastName: 'B' }],
        hireDate: '2026-11-01',
      })
      .expect(403);
  });
});
