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
  /** The same content as `text`, for clients that show HTML. */
  html: string;
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
  return { subject: title, text: lines.join('\n'), html: renderHtml(title, paragraphs, link) };
}

/** Table layout and inline styles: what email clients reliably render. */
function renderHtml(title: string, paragraphs: string[], link: string | null): string {
  const text = 'font-size:14px;line-height:1.5;margin:0 0 12px';
  return [
    '<!doctype html><html lang="es"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title></head>`,
    '<body style="margin:0;padding:24px;background:#f4f5f7;',
    'font-family:Arial,Helvetica,sans-serif;color:#1f2937">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ',
    'style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px">',
    '<tr><td style="padding:24px">',
    '<p style="margin:0 0 16px;font-size:12px;color:#6b7280;text-transform:uppercase">AsistControl</p>',
    `<h1 style="margin:0 0 16px;font-size:18px">${escapeHtml(title)}</h1>`,
    ...paragraphs.map((p) => `<p style="${text}">${escapeHtml(p)}</p>`),
    link
      ? `<p style="margin:20px 0"><a href="${escapeHtml(link)}" style="display:inline-block;` +
        'padding:10px 16px;background:#2563eb;color:#ffffff;text-decoration:none;' +
        'border-radius:6px;font-size:14px">Abrir en AsistControl</a></p>'
      : '',
    `<p style="margin:24px 0 0;font-size:12px;color:#6b7280">${escapeHtml(FOOTER)}</p>`,
    '</td></tr></table></body></html>',
  ].join('');
}

const HTML_ESCAPES = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
]);

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES.get(c)!);
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
