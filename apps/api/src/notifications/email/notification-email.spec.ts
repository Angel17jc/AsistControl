import type { AppNotification } from '@asistcontrol/shared';
import { MAX_EMAIL_ATTEMPTS, nextAttemptAfter } from './email-retry';
import { type EmailContext, renderNotificationEmail } from './notification-email';

const context: EmailContext = {
  appUrl: 'https://asistencia.empresa.com',
  timezone: 'America/Guayaquil',
};
const base = {
  id: 'n1',
  entity: null,
  entityId: null,
  readAt: null,
  createdAt: '2026-09-29T15:00:00.000Z',
};
const render = (n: Omit<AppNotification, keyof typeof base>, ctx = context) =>
  renderNotificationEmail({ ...base, ...n } as AppNotification, ctx);

describe('renderNotificationEmail', () => {
  it('explains a device outage and where to act on it', () => {
    const email = render({
      type: 'DEVICE_DOWN',
      data: {
        deviceName: 'Bodega',
        status: 'OFFLINE',
        error: 'CONNECTION_FAILED: Cannot reach 10.0.0.9',
      },
    });
    expect(email.subject).toBe('Dispositivo sin conexión: Bodega');
    expect(email.text).toContain(
      'Motivo: Sin respuesta del equipo: revise la IP, el puerto y la red (Cannot reach 10.0.0.9).',
    );
    expect(email.text).toContain(
      'Abrir en AsistControl: https://asistencia.empresa.com/dispositivos',
    );
  });

  it('writes dates in the company timezone', () => {
    const email = render({
      type: 'LEAVE_REQUESTED',
      data: {
        employeeName: 'Luis Mendoza',
        leaveType: 'MEDICAL',
        startsAt: '2026-09-30T13:00:00.000Z',
        endsAt: '2026-09-30T15:00:00.000Z',
      },
    });
    expect(email.subject).toBe('Solicitud por revisar: Luis Mendoza');
    expect(email.text).toContain('Médico, del 30 sept 2026, 08:00 al 30 sept 2026, 10:00');
  });

  it('includes the reviewer’s note on a decision', () => {
    const email = render({
      type: 'LEAVE_REVIEWED',
      data: {
        employeeName: 'Luis Mendoza',
        leaveType: 'VACATION',
        startsAt: '2026-10-05T05:00:00.000Z',
        endsAt: '2026-10-10T05:00:00.000Z',
        decision: 'REJECTED',
        note: 'Cierre de mes',
      },
    });
    expect(email.subject).toBe('Solicitud rechazada: Vacaciones');
    expect(email.text).toContain('Nota de quien la revisó: «Cierre de mes»');
  });

  it('warns about expiring vacation days with a calendar date', () => {
    const email = render({
      type: 'VACATION_EXPIRING',
      data: { employeeName: 'Ana', days: 6.5, expiresOn: '2027-01-06' },
    });
    expect(email.subject).toBe('6,5 días de vacaciones caducan el 6 ene 2027');
  });

  it('carries no link without a public address', () => {
    const email = render(
      { type: 'DEVICE_RECOVERED', data: { deviceName: 'Bodega' } },
      { ...context, appUrl: null },
    );
    expect(email.text).not.toContain('Abrir en AsistControl');
  });

  it('keeps names from breaking into a new header line', () => {
    const email = render({
      type: 'DEVICE_RECOVERED',
      data: { deviceName: 'Bodega\r\nBcc: todos@empresa.com' },
    });
    expect(email.subject).toBe('Dispositivo en línea de nuevo: Bodega Bcc: todos@empresa.com');
    expect(email.subject).not.toMatch(/[\r\n]/);
  });
});

describe('renderNotificationEmail — HTML', () => {
  it('carries the same message with the link as a button', () => {
    const email = render({ type: 'DEVICE_RECOVERED', data: { deviceName: 'Bodega' } });
    expect(email.html).toContain(
      '<h1 style="margin:0 0 16px;font-size:18px">Dispositivo en línea de nuevo: Bodega</h1>',
    );
    expect(email.html).toContain('href="https://asistencia.empresa.com/dispositivos"');
    expect(email.html).toContain('Abrir en AsistControl</a>');
    // Plain text stays plain.
    expect(email.text).not.toMatch(/<[a-z]/);
  });

  it('escapes every piece of data, so a name cannot become markup', () => {
    const email = render({
      type: 'LEAVE_REVIEWED',
      data: {
        employeeName: '<img src=x onerror=alert(1)>',
        leaveType: 'VACATION',
        startsAt: '2026-10-05T05:00:00.000Z',
        endsAt: '2026-10-10T05:00:00.000Z',
        decision: 'REJECTED',
        note: '"Cierre" & <b>mes</b>',
      },
    });
    expect(email.html).not.toContain('<img');
    expect(email.html).not.toContain('<b>');
    expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(email.html).toContain('&quot;Cierre&quot; &amp; &lt;b&gt;mes&lt;/b&gt;');
  });

  it('has no link without a public address', () => {
    const email = render(
      { type: 'DEVICE_RECOVERED', data: { deviceName: 'Bodega' } },
      { ...context, appUrl: null },
    );
    expect(email.html).not.toContain('<a ');
  });
});

describe('nextAttemptAfter', () => {
  const now = new Date('2026-09-29T12:00:00Z');
  const minutesLater = (attempts: number) => {
    const at = nextAttemptAfter(attempts, now);
    return at && (at.getTime() - now.getTime()) / 60_000;
  };

  it('backs off, then gives up after the last attempt', () => {
    expect([1, 2, 3, 4].map(minutesLater)).toEqual([1, 5, 15, 60]);
    expect(nextAttemptAfter(MAX_EMAIL_ATTEMPTS, now)).toBeNull();
  });
});
