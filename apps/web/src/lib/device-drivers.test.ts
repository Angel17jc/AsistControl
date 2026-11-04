import { describe, expect, it } from 'vitest';
import { explainDeviceError } from './device-drivers';

describe('explainDeviceError', () => {
  it.each([
    ['AUTHENTICATION_FAILED: 401', 'El equipo rechazó las credenciales (401)'],
    ['CONNECTION_FAILED: ECONNREFUSED', 'Sin respuesta del equipo'],
    ['NOT_CONNECTED: socket closed', 'Se perdió la conexión con el equipo (socket closed)'],
    ['TIMEOUT: 5000 ms', 'El equipo no respondió a tiempo'],
    ['PROTOCOL_ERROR: bad frame', 'El equipo respondió algo inesperado'],
    ['UNSUPPORTED_DRIVER: X', 'El driver no está disponible'],
    ['UNSUPPORTED_OPERATION: push', 'Este equipo no admite esa operación'],
  ])('words %s, keeping the technical detail for support', (error, text) => {
    expect(explainDeviceError(error)).toContain(text);
  });

  it('has something to say without a detail', () => {
    expect(explainDeviceError(null)).toBe('Error desconocido');
  });
});
