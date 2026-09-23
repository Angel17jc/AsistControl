import type { AppNotification } from '@asistcontrol/shared';
import type { Tone } from '../components/ui';
import { explainDeviceError } from './device-drivers';
import { LEAVE_LABEL, formatDateTime } from './format';

export interface NotificationView {
  title: string;
  body: string;
  /** Where the notification leads: the page where it can be acted on. */
  href: string;
  tone: Tone;
}

/**
 * The API sends data, not sentences (ADR 0007); this is where they are written, in Spanish.
 * The switch is exhaustive: a notification type added to the shared contract without its
 * wording here does not compile.
 */
export function describeNotification(notification: AppNotification): NotificationView {
  switch (notification.type) {
    case 'DEVICE_DOWN': {
      const { deviceName, status, error } = notification.data;
      return {
        title: status === 'ERROR' ? 'Dispositivo con error' : 'Dispositivo sin conexión',
        body: `${deviceName}: ${explainDeviceError(error)}`,
        href: '/dispositivos',
        tone: 'critical',
      };
    }
    case 'DEVICE_RECOVERED':
      return {
        title: 'Dispositivo en línea de nuevo',
        body: `${notification.data.deviceName} volvió a responder.`,
        href: '/dispositivos',
        tone: 'good',
      };
    case 'LEAVE_REQUESTED': {
      const { employeeName, leaveType, startsAt, endsAt } = notification.data;
      return {
        title: 'Solicitud por revisar',
        body: `${employeeName} · ${LEAVE_LABEL[leaveType]}, ${range(startsAt, endsAt)}`,
        href: '/solicitudes',
        tone: 'warning',
      };
    }
    case 'LEAVE_REVIEWED': {
      const { employeeName, leaveType, startsAt, endsAt, decision, note } = notification.data;
      const approved = decision === 'APPROVED';
      return {
        title: approved ? 'Solicitud aprobada' : 'Solicitud rechazada',
        body:
          `${employeeName} · ${LEAVE_LABEL[leaveType]}, ${range(startsAt, endsAt)}` +
          (note ? ` — «${note}»` : ''),
        href: '/solicitudes',
        tone: approved ? 'good' : 'critical',
      };
    }
    default:
      return assertNever(notification);
  }
}

function range(startsAt: string, endsAt: string): string {
  return `${formatDateTime(startsAt)} a ${formatDateTime(endsAt)}`;
}

function assertNever(value: never): never {
  throw new Error(`Unknown notification: ${JSON.stringify(value)}`);
}
