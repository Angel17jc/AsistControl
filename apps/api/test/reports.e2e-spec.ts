import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { at, bearer, createApp, createFixture, type Fixture, login } from './utils';

const DAY = '2026-09-21';

/** A report is a finished document for people: values worded, dates in the company's time. */
describe('Reports in Spanish (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let fx: Fixture;
  let hr: string;
  const http = () => request(app.getHttpServer());

  const rowsOf = async (kind: string, from = DAY) => {
    const res = await http().get(`/api/reports/${kind}?from=${from}`).set(bearer(hr)).expect(200);
    return res.body.rows as Record<string, unknown>[];
  };
  const rowOf = async (kind: string, employeeCode: string) =>
    (await rowsOf(kind)).filter((r) => r.codigo === employeeCode);

  beforeAll(async () => {
    app = await createApp();
    prisma = new PrismaClient();
    fx = await createFixture(prisma, 'rep');
    hr = await login(app, fx.emails.hr);

    // Late and working past the shift, with a punch that falls outside the work day.
    await http()
      .post('/api/attendance/events/batch')
      .set(bearer(hr))
      .send({
        employeeId: fx.employee.id,
        punches: ['08:30', '19:00', '23:30'].map((t) => ({ occurredAt: at(t, DAY) })),
        reason: 'Reporte (e2e)',
      })
      .expect(201);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('words the state, the anomalies and whether the day is closed', async () => {
    const [row] = await rowOf('daily', 'REP-2');
    expect(row).toMatchObject({ estado: 'Atrasado', cerrado: 'Sí', entrada: '08:30' });
    expect(String(row!.novedades).split(' · ')).toEqual(
      expect.arrayContaining(['Atraso', 'Horas extra', 'Marcación fuera de jornada']),
    );
    expect(JSON.stringify(row)).not.toMatch(/LATE|STRAY_PUNCH|true|false/);
  });

  it('words each punch', async () => {
    const rows = await rowOf('events', 'REP-2');
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      expect(row).toMatchObject({ tipo: 'Marcación', origen: 'Manual', anulada: 'No' });
    }
  });

  it('words overtime and gives its review in the local time of the company', async () => {
    const record = await prisma.overtimeRecord.findFirstOrThrow({
      where: { employeeId: fx.employee.id },
    });
    await prisma.overtimeRecord.update({
      where: { id: record.id },
      // 02:30 UTC is still the evening before in Guayaquil (UTC-5).
      data: { status: 'APPROVED', reviewedAt: new Date('2026-09-22T02:30:00.000Z') },
    });
    const [row] = await rowOf('overtime', 'REP-2');
    expect(row).toMatchObject({
      tipo: 'Ordinaria',
      estado: 'Aprobada',
      revisado: '2026-09-21 21:30',
    });
  });

  it('explains the failure of a sync', async () => {
    const device = await prisma.device.create({
      data: {
        name: 'Reporte e2e',
        driver: 'MOCK',
        manufacturer: 'X',
        model: 'Y',
        host: 'report-e2e.local',
        port: 4370,
      },
    });
    await prisma.deviceSyncLog.create({
      data: {
        deviceId: device.id,
        trigger: 'SCHEDULED',
        status: 'FAILED',
        startedAt: new Date(at('10:00', DAY)),
        errorMessage: 'CONNECTION_FAILED: ECONNREFUSED',
      },
    });
    const row = (await rowsOf('sync')).find((r) => r.dispositivo === 'Reporte e2e');
    expect(row).toMatchObject({
      origen: 'Programada',
      estado: 'Fallida',
      error: 'Sin respuesta del equipo: revise la IP, el puerto y la red (ECONNREFUSED)',
    });
  });

  it('writes the same words in the CSV', async () => {
    const res = await http()
      .get(`/api/reports/daily?from=${DAY}&format=csv`)
      .set(bearer(hr))
      .expect(200);
    const line = res.text.split('\r\n').find((l) => l.includes('REP-2'));
    expect(line).toContain('Atrasado');
    expect(line).toContain('Marcación fuera de jornada');
    expect(line).toContain(',Sí');
    expect(res.text).not.toContain('STRAY_PUNCH');
  });
});
