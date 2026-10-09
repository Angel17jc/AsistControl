import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { bearer, createApp, createFixture, type Fixture, login } from './utils';

/**
 * Departments and positions: talent management keeps the lists the employee form offers.
 * Deleting is soft, refused while someone still belongs, and frees the name for reuse.
 */
describe('Departments and positions (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let fx: Fixture;
  let hr: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
    prisma = new PrismaClient();
    fx = await createFixture(prisma, 'org');
    hr = await login(app, fx.emails.hr);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('departments', () => {
    it('are created with a normalized code, edited and listed with their head count', async () => {
      const created = await http()
        .post('/api/departments')
        .set(bearer(hr))
        .send({ code: ' log-org ', name: 'Logística ORG' })
        .expect(201);
      expect(created.body).toMatchObject({ code: 'LOG-ORG', name: 'Logística ORG' });

      await http()
        .patch(`/api/departments/${created.body.id}`)
        .set(bearer(hr))
        .send({ name: 'Logística y bodega ORG', description: 'Recepción y despacho' })
        .expect(200);

      const list = await http().get('/api/departments').set(bearer(hr)).expect(200);
      expect(list.body).toContainEqual(
        expect.objectContaining({
          code: 'LOG-ORG',
          name: 'Logística y bodega ORG',
          description: 'Recepción y despacho',
          _count: { employees: 0 },
        }),
      );
    });

    it('refuse a code that is already in use', async () => {
      await http()
        .post('/api/departments')
        .set(bearer(hr))
        .send({ code: 'DUP-ORG', name: 'Primero ORG' })
        .expect(201);
      const res = await http()
        .post('/api/departments')
        .set(bearer(hr))
        .send({ code: 'dup-org', name: 'Segundo ORG' })
        .expect(409);
      expect(res.body.message).toBe('A record with the same code already exists');
    });

    it('cannot be deleted while someone belongs; once empty, the code is free again', async () => {
      const department = await http()
        .post('/api/departments')
        .set(bearer(hr))
        .send({ code: 'TMP-ORG', name: 'Temporal ORG' })
        .expect(201);
      const id = department.body.id as string;
      await prisma.employee.update({ where: { id: fx.employee.id }, data: { departmentId: id } });

      const refused = await http().delete(`/api/departments/${id}`).set(bearer(hr)).expect(409);
      expect(refused.body.message).toBe('Department has 1 employee(s); reassign them first');

      await prisma.employee.update({ where: { id: fx.employee.id }, data: { departmentId: null } });
      await http().delete(`/api/departments/${id}`).set(bearer(hr)).expect(204);

      const list = await http().get('/api/departments').set(bearer(hr)).expect(200);
      expect(list.body.map((d: { id: string }) => d.id)).not.toContain(id);
      await http().get(`/api/departments/${id}`).set(bearer(hr)).expect(404);
      await http()
        .post('/api/departments')
        .set(bearer(hr))
        .send({ code: 'TMP-ORG', name: 'Temporal ORG' })
        .expect(201);
    });
  });

  describe('positions', () => {
    it('are listed with their head count and cannot be deleted while in use', async () => {
      const position = await http()
        .post('/api/positions')
        .set(bearer(hr))
        .send({ name: '  Bodeguero ORG ' })
        .expect(201);
      const id = position.body.id as string;
      expect(position.body.name).toBe('Bodeguero ORG');
      await prisma.employee.update({ where: { id: fx.teammate.id }, data: { positionId: id } });

      const list = await http().get('/api/positions').set(bearer(hr)).expect(200);
      expect(list.body).toContainEqual(
        expect.objectContaining({ id, name: 'Bodeguero ORG', _count: { employees: 1 } }),
      );
      const refused = await http().delete(`/api/positions/${id}`).set(bearer(hr)).expect(409);
      expect(refused.body.message).toBe('Position has 1 employee(s); reassign them first');

      await prisma.employee.update({ where: { id: fx.teammate.id }, data: { positionId: null } });
      await http().delete(`/api/positions/${id}`).set(bearer(hr)).expect(204);
      await http()
        .post('/api/positions')
        .set(bearer(hr))
        .send({ name: 'Bodeguero ORG' })
        .expect(201);
    });
  });

  it('are managed by talent management and administrators only', async () => {
    const supervisor = await login(app, fx.emails.supervisor);
    await http().get('/api/departments').set(bearer(supervisor)).expect(403);
    await http()
      .post('/api/positions')
      .set(bearer(supervisor))
      .send({ name: 'Intruso ORG' })
      .expect(403);
  });
});
