import {
  type AppNotification,
  LEAVE_TYPE_LABEL,
  type LeaveType,
  explainDeviceError,
} from '@asistcontrol/shared';
import { DateTime } from 'luxon';
import { type RenderedEmail, renderEmailHtml, singleLine } from '../../mail/email-layout';

export type { RenderedEmail };

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

export function renderNotificationEmail(
  notification: AppNotification,
  context: EmailContext,
): RenderedEmail {
  const when = (iso: string) =>
    DateTime.fromISO(iso, { zone: context.timezone }).setLocale('es').toFormat('d LLL yyyy, HH:mm');
  const day = (isoDate: string) =>
    DateTime.fromISO(isoDate, { zone: 'utc' }).setLocale('es').toFormat('d LLL yyyy');
  const leave = (d: { leaveType: LeaveType; startsAt: string; endsAt: string }) =>
    `${LEAVE_TYPE_LABEL[d.leaveType]}, del ${when(d.startsAt)} al ${when(d.endsAt)}`;

  switch (notification.type) {
    case 'DEVICE_DOWN': {
      const { deviceName, status, error } = notification.data;
      return compose(
        `${status === 'ERROR' ? 'Dispositivo con error' : 'Dispositivo sin conexión'}: ${deviceName}`,
        [
          `El marcador "${deviceName}" dejó de responder a la sincronización.`,
          `Motivo: ${error ? explainDeviceError(error) : 'error desconocido'}.`,
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
        `Solicitud ${approved ? 'aprobada' : 'rechazada'}: ${LEAVE_TYPE_LABEL[data.leaveType]}`,
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

const FOOTER =
  'Este aviso también está en la campana de AsistControl, donde puede elegir qué avisos ' +
  'recibir por correo.';

/**
 * The same message twice: plain text, and HTML for clients that show it. In the HTML every
 * piece of data is escaped (names come from people and devices), and the only link is the
 * configured public address plus a fixed path: no data ever reaches an href.
 */
function compose(
  subject: string,
  paragraphs: string[],
  path: string,
  { appUrl }: EmailContext,
): RenderedEmail {
  const link = appUrl ? `${appUrl}${path}` : null;
  const lines = [...paragraphs];
  if (link) lines.push('', `Abrir en AsistControl: ${link}`);
  lines.push('', '—', FOOTER);
  // Names come from people and devices: never let them break into a new header line.
  const title = singleLine(subject);
  const html = renderEmailHtml({
    title,
    paragraphs,
    action: link ? { label: 'Abrir en AsistControl', url: link } : null,
    footer: FOOTER,
  });
  return { subject: title, text: lines.join('\n'), html };
}

function formatDays(days: number): string {
  const value = new Intl.NumberFormat('es-EC', { maximumFractionDigits: 2 }).format(days);
  return `${value} ${Math.abs(days) === 1 ? 'día' : 'días'}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function assertNever(value: never): never {
  throw new Error(`Unknown notification: ${JSON.stringify(value)}`);
}
