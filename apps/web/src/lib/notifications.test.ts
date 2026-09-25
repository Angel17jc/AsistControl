import type { AppNotification } from '@asistcontrol/shared';
import { describe, expect, it } from 'vitest';
import { describeNotification } from './notifications';

const base = {
  id: 'n1',
  entity: null,
  entityId: null,
  readAt: null,
  createdAt: '2026-09-23T15:00:00.000Z',
};
const leave = {
  employeeName: 'Luis Mendoza',
  leaveType: 'MEDICAL',
  startsAt: '2026-09-24T13:00:00.000Z',
  endsAt: '2026-09-24T15:00:00.000Z',
} as const;

describe('describeNotification', () => {
  it('explains a device outage with the reason an operator can act on', () => {
    const view = describeNotification({
      ...base,
      type: 'DEVICE_DOWN',
      data: {
        deviceName: 'Bodega',
        status: 'ERROR',
        error: 'AUTHENTICATION_FAILED: Device rejected the username or password',
      },
    });
    expect(view).toMatchObject({
      title: 'Dispositivo con error',
      href: '/dispositivos',
      tone: 'critical',
    });
    expect(view.body).toMatch(/^Bodega: El equipo rechazó las credenciales/);
  });

  it('says an offline device is offline', () => {
    const view = describeNotification({
      ...base,
      type: 'DEVICE_DOWN',
      data: { deviceName: 'Bodega', status: 'OFFLINE', error: null },
    });
    expect(view.title).toBe('Dispositivo sin conexión');
  });

  it('announces a recovery', () => {
    const view = describeNotification({
      ...base,
      type: 'DEVICE_RECOVERED',
      data: { deviceName: 'Bodega' },
    });
    expect(view).toMatchObject({ body: 'Bodega volvió a responder.', tone: 'good' });
  });

  it('points a reviewer at the request', () => {
    const view = describeNotification({ ...base, type: 'LEAVE_REQUESTED', data: leave });
    expect(view).toMatchObject({ title: 'Solicitud por revisar', href: '/solicitudes' });
    expect(view.body).toMatch(/^Luis Mendoza · Médico, /);
  });

  it('gives the decision and the reviewer note', () => {
    const view = describeNotification({
      ...base,
      type: 'LEAVE_REVIEWED',
      data: { ...leave, decision: 'REJECTED', note: 'Coincide con el inventario' },
    } satisfies AppNotification);
    expect(view).toMatchObject({ title: 'Solicitud rechazada', tone: 'critical' });
    expect(view.body).toMatch(/«Coincide con el inventario»$/);
  });

  it('warns about vacation days about to expire, pointing to where they are requested', () => {
    const view = describeNotification({
      ...base,
      type: 'VACATION_EXPIRING',
      data: { employeeName: 'Luis Mendoza', days: 6.5, expiresOn: '2027-01-06' },
    });
    expect(view).toEqual({
      title: 'Vacaciones por caducar',
      body: '6,5 días de vacaciones caducan el 6 ene 2027 si no los usas antes.',
      href: '/solicitudes',
      tone: 'warning',
    });
  });
});
