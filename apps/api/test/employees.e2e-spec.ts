import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { bearer, createApp, createFixture, type Fixture, login } from './utils';

/**
 * Editing an employee over their working life: data changes, optional fields cleared,
 * a termination and a reinstatement. Only HR and admins may do it.
 */
describe('Employee editing (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let fx: Fixture;
  let hr: string;
  const http = () => request(app.getHttpServer());
  const patch = (body: object, token = hr, id = fx.teammate.id) =>
    http().patch(`/api/employees/${id}`).set(bearer(token)).send(body);

  beforeAll(async () => {
    app = await createApp();
    prisma = new PrismaClient();
    fx = await createFixture(prisma, 'emp');
    hr = await login(app, fx.emails.hr);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('updates personal and organisational data', async () => {
    const department = await prisma.department.create({
      data: { code: 'EMPOPS', name: 'Operaciones emp' },
    });
    const res = await patch({
      firstName: 'Luisa',
      email: 'Luisa.Vera@Empresa.Local',
      phone: '+593 99 000 0000',
      departmentId: department.id,
    }).expect(200);

    expect(res.body).toMatchObject({
      firstName: 'Luisa',
      email: 'luisa.vera@empresa.local',
      phone: '+593 99 000 0000',
      department: { id: department.id },
    });
  });

  it('clears optional fields with null', async () => {
    const res = await patch({ email: null, phone: null, departmentId: null }).expect(200);
    expect(res.body).toMatchObject({ email: null, phone: null, department: null });
  });

  it('records a termination and clears it on reinstatement', async () => {
    const terminated = await patch({ status: 'INACTIVE', terminatedAt: '2026-06-30' }).expect(200);
    expect(terminated.body).toMatchObject({ status: 'INACTIVE', terminatedAt: '2026-06-30' });

    // Leaving terminatedAt out keeps it…
    expect((await patch({ phone: '+593 99 111 1111' }).expect(200)).body.terminatedAt).toBe(
      '2026-06-30',
    );
    // …and null clears it: the person is back.
    const reinstated = await patch({ status: 'ACTIVE', terminatedAt: null }).expect(200);
    expect(reinstated.body).toMatchObject({ status: 'ACTIVE', terminatedAt: null });
  });

  it('rejects inconsistent changes', async () => {
    await patch({ supervisorId: fx.teammate.id }).expect(400);
    await patch({ hireDate: '30/06/2026' }).expect(400);
    await patch({ status: 'FIRED' }).expect(400);
    // Another employee's code is taken.
    const other = await prisma.employee.findUniqueOrThrow({ where: { id: fx.employee.id } });
    await patch({ employeeCode: other.employeeCode }).expect(409);
  });

  it('is reserved to HR and admins', async () => {
    const supervisor = await login(app, fx.emails.supervisor);
    await patch({ firstName: 'Nope' }, supervisor).expect(403);
    const employee = await login(app, fx.emails.employee);
    await patch({ firstName: 'Nope' }, employee, fx.employee.id).expect(403);
  });
});
