import type { ArgumentsHost } from '@nestjs/common';
import { ConflictException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { apiError } from '../errors/api-error';
import { AllExceptionsFilter } from './all-exceptions.filter';

function respond(exception: unknown) {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ url: '/api/x', id: 'req-1' }),
      getResponse: () => res,
    }),
  } as unknown as ArgumentsHost;
  const filter = new AllExceptionsFilter();
  jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
  filter.catch(exception, host);
  return { status: res.status.mock.calls[0]![0] as number, body: res.json.mock.calls[0]![0] };
}

const prismaError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('secret SQL detail', { code, clientVersion: 'x', meta });

describe('AllExceptionsFilter', () => {
  it('passes on the code, the params and the English message of an error', () => {
    const { status, body } = respond(
      new ConflictException(apiError('DEPARTMENT_IN_USE', 'Department in use', { employees: 3 })),
    );
    expect(status).toBe(409);
    expect(body).toMatchObject({
      code: 'DEPARTMENT_IN_USE',
      params: { employees: 3 },
      message: 'Department in use',
      statusCode: 409,
      requestId: 'req-1',
    });
  });

  it('leaves params out of an error that has none', () => {
    const { body } = respond(
      new NotFoundException(apiError('DEVICE_NOT_FOUND', 'Device not found')),
    );
    expect(body).not.toHaveProperty('params');
  });

  it.each([
    [new NotFoundException('Cannot GET /x'), 'NOT_FOUND'],
    [new ThrottlerException(), 'TOO_MANY_REQUESTS'],
    [new HttpException('Payload too large', HttpStatus.PAYLOAD_TOO_LARGE), 'REQUEST_FAILED'],
    [new HttpException('Bad gateway', HttpStatus.BAD_GATEWAY), 'INTERNAL_ERROR'],
  ])('gives a code by status to what comes without one: %s', (exception, code) => {
    expect(respond(exception).body.code).toBe(code);
  });

  it('names a duplicate by the properties of the API, not by its columns', () => {
    const { status, body } = respond(prismaError('P2002', { target: ['employee_code'] }));
    expect(status).toBe(409);
    expect(body).toMatchObject({
      code: 'DUPLICATE_RECORD',
      params: { fields: ['employeeCode'] },
      message: 'A record with the same employee_code already exists',
    });
  });

  it('survives a duplicate whose target is a constraint name', () => {
    const { status, body } = respond(prismaError('P2002', { target: 'employees_code_key' }));
    expect(status).toBe(409);
    expect(body).toMatchObject({ code: 'DUPLICATE_RECORD', params: { fields: [] } });
  });

  it('maps the other database errors without leaking their detail', () => {
    expect(respond(prismaError('P2025')).body.code).toBe('NOT_FOUND');
    expect(respond(prismaError('P2003')).body.code).toBe('RECORD_IN_USE');
    const { status, body } = respond(prismaError('P9999'));
    expect(status).toBe(500);
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('hides an unexpected error behind a generic one', () => {
    const { status, body } = respond(new Error('secret stack'));
    expect(status).toBe(500);
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});
