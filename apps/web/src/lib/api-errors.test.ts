import type {
  ApiErrorCode,
  ApiErrorParams,
  ApiErrorResponse,
  ApiViolation,
} from '@asistcontrol/shared';
import { describe, expect, it } from 'vitest';
import { describeApiError } from './api-errors';

/** A response as the API sends it, with an English message nobody should get to see. */
function response<C extends ApiErrorCode>(
  code: C,
  params?: ApiErrorParams[C],
  rest: Partial<ApiErrorResponse> = {},
): ApiErrorResponse {
  return {
    statusCode: 400,
    error: 'X',
    code,
    params,
    message: 'ENGLISH MESSAGE',
    path: '/api/x',
    timestamp: '2026-11-04T00:00:00.000Z',
    ...rest,
  };
}

const invalid = (...violations: ApiViolation[]) =>
  describeApiError(400, response('VALIDATION_FAILED', { violations }));

describe('describeApiError', () => {
  it('words a code with its values', () => {
    expect(
      describeApiError(
        409,
        response('VACATION_INSUFFICIENT_BALANCE', {
          availableDays: 12.5,
          requestedDays: 15,
          startDate: '2026-12-07',
        }),
      ),
    ).toBe(
      'Saldo de vacaciones insuficiente: al 7 dic 2026 tendrá 12,5 días y esta solicitud usa 15 días.',
    );
    expect(describeApiError(409, response('DEPARTMENT_IN_USE', { employees: 1 }))).toContain(
      'tiene 1 empleado.',
    );
    expect(describeApiError(409, response('DEPARTMENT_IN_USE', { employees: 3 }))).toContain(
      'tiene 3 empleados.',
    );
    expect(describeApiError(409, response('LEAVE_ALREADY_DECIDED', { status: 'APPROVED' }))).toBe(
      'Esta solicitud ya está aprobada.',
    );
    expect(describeApiError(400, response('ACCOUNT_NEEDS_EMPLOYEE', { role: 'SUPERVISOR' }))).toBe(
      'Una cuenta de Supervisor debe estar vinculada a un empleado.',
    );
    expect(
      describeApiError(
        409,
        response('DEVICE_ADDRESS_IN_USE', { name: 'Bodega', host: '10.0.0.5', port: 80 }),
      ),
    ).toBe('El dispositivo «Bodega» ya usa la dirección 10.0.0.5:80.');
  });

  it('names what is duplicated as the form calls it', () => {
    expect(describeApiError(409, response('DUPLICATE_RECORD', { fields: ['biometricId'] }))).toBe(
      'Ya hay otro registro con el mismo valor en «ID biométrico».',
    );
    expect(describeApiError(409, response('DUPLICATE_RECORD', { fields: [] }))).toBe(
      'Ya hay otro registro con esos datos.',
    );
  });

  describe('validation', () => {
    it('says what each format asks for, as the form calls the field', () => {
      expect(invalid({ field: 'employeeCode', rule: 'matches' })).toBe(
        'Código interno: use de 2 a 20 letras, números o guiones, sin espacios.',
      );
      expect(invalid({ field: 'hireDate', rule: 'matches' })).toBe(
        'Fecha de ingreso: no es una fecha válida.',
      );
    });

    it('lists every field, one sentence each', () => {
      expect(
        invalid({ field: 'email', rule: 'isEmail' }, { field: 'phone', rule: 'matches' }),
      ).toBe(
        'Correo: no es un correo válido. Teléfono: use de 6 a 20 caracteres: números, espacios, +, paréntesis o guiones.',
      );
    });

    it('says a missing value is required, not that it is too long', () => {
      expect(
        invalid(
          { field: 'firstName', rule: 'maxLength' },
          { field: 'firstName', rule: 'minLength' },
          { field: 'firstName', rule: 'isString' },
        ),
      ).toBe('Nombres: es obligatorio.');
    });

    it('finds the field of a nested path', () => {
      expect(invalid({ field: 'punches.0.occurredAt', rule: 'isIso8601' })).toBe(
        'Hora: no es una fecha válida.',
      );
    });

    it('words the rules of the attendance policy', () => {
      expect(invalid({ field: 'lateToleranceMinutes', rule: 'too_small' })).toBe(
        'Tolerancia de atraso: está por debajo del mínimo permitido.',
      );
    });

    it('stays readable with many fields', () => {
      const text = invalid(
        ...['firstName', 'lastName', 'email', 'phone', 'hireDate', 'code'].map((field) => ({
          field,
          rule: 'isString',
        })),
      );
      expect(text).toContain('Teléfono: es obligatorio.');
      expect(text).not.toContain('Fecha de ingreso');
      expect(text).toContain('Hay 2 datos más por revisar.');
    });

    it('has something to say about a field or rule it does not know', () => {
      expect(invalid({ field: 'newThing', rule: 'newRule' })).toBe('newThing: no es válido.');
      expect(invalid({ field: 'constructor', rule: 'toString' })).toBe(
        'constructor: no es válido.',
      );
      expect(invalid()).toBe('La solicitud no es válida. Revise los datos e intente de nuevo.');
    });
  });

  describe('what comes without a usable code', () => {
    it.each([
      [400, 'La solicitud no es válida'],
      [401, 'Su sesión terminó'],
      [403, 'No tiene permiso'],
      [404, 'No se encontró'],
      [409, 'los datos cambiaron'],
      [413, 'No se pudo completar la solicitud'],
      [429, 'Demasiados intentos'],
      [500, 'Ocurrió un error en el servidor'],
    ])('answers a %i by its status, never in English', (status, text) => {
      const stranger = response('BAD_REQUEST', undefined, {
        code: 'SOMETHING_NEWER' as ApiErrorCode,
      });
      expect(describeApiError(status, stranger)).toContain(text);
      expect(describeApiError(status, null)).toContain(text);
      expect(describeApiError(status, stranger)).not.toContain('ENGLISH');
    });

    it('survives a body with no code at all, or a prototype key as one', () => {
      expect(describeApiError(403, { message: 'nope' } as ApiErrorResponse)).toBe(
        'No tiene permiso para hacer esto.',
      );
      expect(
        describeApiError(
          404,
          response('NOT_FOUND', undefined, { code: 'toString' as ApiErrorCode }),
        ),
      ).toContain('No se encontró');
    });

    it('survives a known code with data of another shape', () => {
      const broken = response('VALIDATION_FAILED', undefined);
      expect(describeApiError(400, broken)).toBe(
        'No se pudo completar la solicitud. Revise los datos e intente de nuevo.',
      );
    });
  });

  describe('server failures', () => {
    it('tells the same for every gateway failure, with or without a body', () => {
      for (const status of [502, 503, 504]) {
        expect(describeApiError(status, null)).toContain('El servidor no está disponible');
      }
    });

    it('gives the request id, which is what finds the failure in the logs', () => {
      expect(
        describeApiError(500, response('INTERNAL_ERROR', undefined, { requestId: 'abc-123' })),
      ).toBe(
        'Ocurrió un error en el servidor. Si se repite, avise al administrador. Código: abc-123.',
      );
    });
  });
});
