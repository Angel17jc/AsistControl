import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import { strFromU8, unzipSync } from 'fflate';
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

  describe('the month of attendance', () => {
    /** supertest keeps a file's bytes only when told to. */
    const file = (query: string, token = hr) =>
      http()
        .get(`/api/reports/${query}`)
        .set(bearer(token))
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        });
    const textOf = (res: { body: Buffer }) => JSON.parse(res.body.toString()) as { code: string };

    it('lists each person day by day, from any day of the month', async () => {
      const rows = (await rowsOf('attendance', '2026-09-15')).filter((r) => r.codigo === 'REP-2');
      const day = rows.find((r) => r.fecha === DAY);
      expect(rows).toHaveLength(30);
      expect(day).toMatchObject({
        dia: 'lun',
        entrada: '08:30',
        salida: '19:00',
        estado: 'Atrasado',
      });
    });

    it('comes as an Excel workbook named after the month', async () => {
      const res = await file(`attendance?from=${DAY}&format=xlsx`).expect(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain('asistencia-2026-09.xlsx');
      const zip = unzipSync(new Uint8Array(res.body as Buffer));
      const workbook = strFromU8(zip['xl/workbook.xml']!);
      expect(workbook).toContain('name="Asistencia"');
      expect(workbook).toContain('name="Resumen"');
    });

    it('comes as a PDF to sign', async () => {
      const res = await file(`attendance?from=${DAY}&format=pdf`).expect(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toContain('asistencia-2026-09.pdf');
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('offers any other report in Excel, but not as a PDF', async () => {
      const excel = await file(`daily?from=${DAY}&format=xlsx`).expect(200);
      expect(excel.headers['content-disposition']).toContain('.xlsx');
      const pdf = await file(`daily?from=${DAY}&format=pdf`).expect(400);
      expect(textOf(pdf as unknown as { body: Buffer })).toMatchObject({
        code: 'REPORT_FORMAT_UNSUPPORTED',
      });
    });

    it('is only for those who can read reports', async () => {
      const employee = await login(app, fx.emails.employee);
      await file(`attendance?from=${DAY}&format=xlsx`, employee).expect(403);
    });
  });

  it('counts a day worked without a schedule as attended in the monthly summary', async () => {
    const employee = await prisma.employee.create({
      data: {
        employeeCode: 'REP-NS',
        identification: 'REPNS0001',
        firstName: 'Sin',
        lastName: 'Horario',
        hireDate: new Date('2026-01-01'),
      },
    });
    await http()
      .post('/api/attendance/events/batch')
      .set(bearer(hr))
      .send({
        employeeId: employee.id,
        punches: ['08:00', '17:00'].map((t) => ({ occurredAt: at(t, DAY) })),
        reason: 'Sin horario (e2e)',
      })
      .expect(201);
    const [row] = await rowOf('monthly', 'REP-NS');
    expect(row).toMatchObject({ dias_asistidos: 1 });
  });

  it('gives the lunch its own columns in the daily report', async () => {
    await http()
      .post('/api/attendance/events/batch')
      .set(bearer(hr))
      .send({
        employeeId: fx.teammate.id,
        punches: ['08:00', '13:05', '14:02', '17:00'].map((t) => ({ occurredAt: at(t, DAY) })),
        reason: 'Almuerzo (e2e)',
      })
      .expect(201);
    const code = (await prisma.employee.findUniqueOrThrow({ where: { id: fx.teammate.id } }))
      .employeeCode;
    const [row] = await rowOf('daily', code);
    expect(row).toMatchObject({ salida_almuerzo: '13:05', regreso_almuerzo: '14:02' });
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
