import type { AppNotification, LeaveType } from '@asistcontrol/shared';
import { DateTime } from 'luxon';

/**
 * The email channel is one more client of the notification data (ADR 0007): this is where
 * it is written, in Spanish, like the web writes the bell. Pure: no Nest, no clock.
 * The switch is exhaustive, so a new notification type without its email does not compile.
 */
export interface EmailContext {
  /** Public address of the web app; null = the email carries no link. */
  appUrl: string | null;
  /** Company timezone, to write dates as people read them. */
  timezone: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
}

const LEAVE_LABEL: Record<LeaveType, string> = {
  PERSONAL: 'Permiso personal',
  MEDICAL: 'Médico',
  VACATION: 'Vacaciones',
  OTHER: 'Otro',
};

const DEVICE_ERROR = new Map<string, string>([
  ['AUTHENTICATION_FAILED', 'El equipo rechazó las credenciales'],
  ['CONNECTION_FAILED', 'Sin respuesta del equipo: revise la IP, el puerto y la red'],
  ['TIMEOUT', 'El equipo no respondió a tiempo'],
  ['PROTOCOL_ERROR', 'El equipo respondió algo inesperado'],
  ['UNSUPPORTED_DRIVER', 'El driver no está disponible en este servidor'],
]);

export function renderNotificationEmail(
  notification: AppNotification,
  context: EmailContext,
): RenderedEmail {
  const when = (iso: string) =>
    DateTime.fromISO(iso, { zone: context.timezone }).setLocale('es').toFormat('d LLL yyyy, HH:mm');
  const day = (isoDate: string) =>
    DateTime.fromISO(isoDate, { zone: 'utc' }).setLocale('es').toFormat('d LLL yyyy');
  const leave = (d: { leaveType: LeaveType; startsAt: string; endsAt: string }) =>
    `${LEAVE_LABEL[d.leaveType]}, del ${when(d.startsAt)} al ${when(d.endsAt)}`;

  switch (notification.type) {
    case 'DEVICE_DOWN': {
      const { deviceName, status, error } = notification.data;
      return compose(
        `${status === 'ERROR' ? 'Dispositivo con error' : 'Dispositivo sin conexión'}: ${deviceName}`,
        [
          `El marcador "${deviceName}" dejó de responder a la sincronización.`,
          `Motivo: ${explainDeviceError(error)}.`,
          'Las marcaciones no se pierden: quedan en el equipo y se descargan cuando vuelva.',
        ],
        '/dispositivos',
        context,
      );
    }
    case 'DEVICE_RECOVERED': {
      const { deviceName } = notification.data;
      return compose(
        `Dispositivo en línea de nuevo: ${deviceName}`,
        [`El marcador "${deviceName}" volvió a responder y se descargó lo pendiente.`],
        '/dispositivos',
        context,
      );
    }
    case 'LEAVE_REQUESTED': {
      const data = notification.data;
      return compose(
        `Solicitud por revisar: ${data.employeeName}`,
        [`${data.employeeName} pidió: ${leave(data)}.`, 'Está esperando su revisión.'],
        '/solicitudes',
        context,
      );
    }
    case 'LEAVE_REVIEWED': {
      const data = notification.data;
      const approved = data.decision === 'APPROVED';
      return compose(
        `Solicitud ${approved ? 'aprobada' : 'rechazada'}: ${LEAVE_LABEL[data.leaveType]}`,
        [
          `La solicitud de ${data.employeeName} (${leave(data)}) fue ${approved ? 'aprobada' : 'rechazada'}.`,
          ...(data.note ? [`Nota de quien la revisó: «${data.note}»`] : []),
        ],
        '/solicitudes',
        context,
      );
    }
    case 'VACATION_EXPIRING': {
      const { days, expiresOn } = notification.data;
      const amount = `${formatDays(days)} de vacaciones`;
      return compose(
        `${capitalize(amount)} caducan el ${day(expiresOn)}`,
        [
          `${capitalize(amount)} caducan el ${day(expiresOn)} si no los usa antes.`,
          'Puede solicitarlas desde AsistControl.',
        ],
        '/solicitudes',
        context,
      );
    }
    default:
      return assertNever(notification);
  }
}

function compose(
  subject: string,
  paragraphs: string[],
  path: string,
  { appUrl }: EmailContext,
): RenderedEmail {
  const lines = [...paragraphs];
  if (appUrl) lines.push('', `Abrir en AsistControl: ${appUrl}${path}`);
  lines.push(
    '',
    '—',
    'Este aviso también está en la campana de AsistControl. ' +
      'Si no quiere recibirlos por correo, desactívelos en su cuenta.',
  );
  // Names come from people and devices: never let them break into a new header line.
  return { subject: singleLine(subject), text: lines.join('\n') };
}

function explainDeviceError(error: string | null): string {
  if (!error) return 'error desconocido';
  const separator = error.indexOf(': ');
  const code = separator === -1 ? error : error.slice(0, separator);
  const reason = DEVICE_ERROR.get(code);
  return reason ? `${reason} (${error.slice(separator + 2)})` : error;
}

function formatDays(days: number): string {
  const value = new Intl.NumberFormat('es-EC', { maximumFractionDigits: 2 }).format(days);
  return `${value} ${Math.abs(days) === 1 ? 'día' : 'días'}`;
}

function singleLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim();
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function assertNever(value: never): never {
  throw new Error(`Unknown notification: ${JSON.stringify(value)}`);
}
