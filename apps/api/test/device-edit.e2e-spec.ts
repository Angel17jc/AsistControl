import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { WORK_DATE, bearer, createApp, createFixture, type Fixture, login } from './utils';

/**
 * Editing a device is more than renaming it: driver, host and port say *which terminal* the
 * platform talks to, and what it knew about the previous one (sync cursor, serial number,
 * credentials) must not be applied to another.
 */
describe('Device editing (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let fx: Fixture;
  let admin: string;
  const http = () => request(app.getHttpServer());
  const patch = (id: string, body: object) =>
    http().patch(`/api/devices/${id}`).set(bearer(admin)).send(body);
  const row = (id: string) => prisma.device.findUniqueOrThrow({ where: { id } });

  let host = 0;
  /** A MOCK terminal that has already been synced once, so it has a cursor and a serial. */
  async function syncedDevice(extra: object = {}): Promise<string> {
    const created = await http()
      .post('/api/devices')
      .set(bearer(admin))
      .send({
        name: `Editable ${++host}`,
        driver: 'MOCK',
        manufacturer: 'AsistControl',
        model: 'AC-SIM-100',
        host: `10.44.0.${host}`,
        port: 4370,
        ...extra,
      })
      .expect(201);
    const id = created.body.id as string;
    await http()
      .post(`/api/devices/${id}/simulate/workday`)
      .set(bearer(admin))
      .send({ date: WORK_DATE, scenario: 'ON_TIME', employeeIds: [fx.employee.id] })
      .expect(201);
    await http().post(`/api/devices/${id}/sync`).set(bearer(admin)).expect(200);
    const synced = await row(id);
    expect(synced.lastSyncCursor).not.toBeNull();
    expect(synced.serialNumber).not.toBeNull();
    return id;
  }

  beforeAll(async () => {
    app = await createApp();
    prisma = new PrismaClient();
    fx = await createFixture(prisma, 'edit');
    admin = await login(app, fx.emails.admin);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('renames and relocates without touching what the platform knows of the terminal', async () => {
    const id = await syncedDevice();
    const before = await row(id);

    const res = await patch(id, { name: 'Recepción norte', location: 'Planta 2' }).expect(200);
    expect(res.body).toMatchObject({ name: 'Recepción norte', location: 'Planta 2' });

    const after = await row(id);
    expect(after.lastSyncCursor).toBe(before.lastSyncCursor);
    expect(after.serialNumber).toBe(before.serialNumber);
    expect(after.status).toBe(before.status);
  });

  it('sending the same address again is not a new terminal', async () => {
    const id = await syncedDevice();
    const before = await row(id);
    await patch(id, { host: before.host, port: before.port, driver: 'MOCK' }).expect(200);
    expect((await row(id)).lastSyncCursor).toBe(before.lastSyncCursor);
  });

  it('starts the next sync over when the address points at another terminal', async () => {
    const id = await syncedDevice();
    await patch(id, { host: '10.44.1.1' }).expect(200);

    const after = await row(id);
    expect(after).toMatchObject({
      lastSyncCursor: null,
      serialNumber: null,
      status: 'OFFLINE',
      lastError: null,
    });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entity: 'Device', entityId: id, action: 'update' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.metadata).toMatchObject({ syncCursorReset: true });
  });

  it('never lets a new driver inherit the credentials of the old one', async () => {
    const id = await syncedDevice({ credentials: { commKey: '1234' } });
    expect((await http().get(`/api/devices/${id}`).set(bearer(admin))).body.hasCredentials).toBe(
      true,
    );

    const res = await patch(id, { driver: 'ZKTECO', port: 4371 }).expect(200);
    expect(res.body.hasCredentials).toBe(false);
    expect((await row(id)).lastSyncCursor).toBeNull();
  });

  it('removes stored credentials on request, and audits it', async () => {
    const id = await syncedDevice({ credentials: { commKey: '1234' } });

    const res = await patch(id, { credentials: null }).expect(200);
    expect(res.body.hasCredentials).toBe(false);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entity: 'Device', entityId: id, action: 'device.credentials_changed' },
    });
    expect(audit.metadata).toEqual({ removed: true });
  });

  it('keeps credentials when the edit does not mention them', async () => {
    const id = await syncedDevice({ credentials: { commKey: '1234' } });
    expect((await patch(id, { name: 'Sin tocar la clave' }).expect(200)).body.hasCredentials).toBe(
      true,
    );
    expect(
      await prisma.auditLog.count({
        where: { entity: 'Device', entityId: id, action: 'device.credentials_changed' },
      }),
    ).toBe(0);
  });

  it('disables and re-enables a terminal', async () => {
    const id = await syncedDevice();

    expect((await patch(id, { enabled: false }).expect(200)).body.status).toBe('DISABLED');
    await http().post(`/api/devices/${id}/sync`).set(bearer(admin)).expect(400);
    // Moving a disabled terminal keeps it disabled.
    await patch(id, { host: '10.44.2.1' }).expect(200);
    expect((await row(id)).status).toBe('DISABLED');

    expect((await patch(id, { enabled: true }).expect(200)).body.status).toBe('OFFLINE');
  });

  it('only lets device administrators edit', async () => {
    const id = await syncedDevice();
    const hr = await login(app, fx.emails.hr);
    await http()
      .patch(`/api/devices/${id}`)
      .set(bearer(hr))
      .send({ name: 'No autorizado' })
      .expect(403);
  });
});
