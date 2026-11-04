import {
  ATTENDANCE_STATUS_LABEL,
  type AttendanceStatus,
  type DeviceStatus,
  type PresenceState,
  REQUEST_STATUS_LABEL,
  type RequestStatus,
  SYNC_STATUS_LABEL,
  type SyncStatus,
} from '@asistcontrol/shared';
import type { Tone } from './ui';

/** The shared names of a domain's values, with the tone each one is shown in. */
function toned<K extends string>(
  labels: Record<K, string>,
  tones: Record<K, Tone>,
): Record<K, { label: string; tone: Tone }> {
  const entries = (Object.keys(tones) as K[]).map((k) => [k, { label: labels[k], tone: tones[k] }]);
  return Object.fromEntries(entries) as Record<K, { label: string; tone: Tone }>;
}

export const ATTENDANCE_STATUS = toned<AttendanceStatus>(ATTENDANCE_STATUS_LABEL, {
  PRESENT: 'good',
  LATE: 'warning',
  INCOMPLETE: 'serious',
  ABSENT: 'critical',
  ON_LEAVE: 'info',
  REST_DAY: 'neutral',
  HOLIDAY: 'neutral',
  NO_SCHEDULE: 'neutral',
});

/** Presence board: where a person is right now. */
export const PRESENCE_STATE: Record<PresenceState, { label: string; tone: Tone }> = {
  IN: { label: 'En la empresa', tone: 'good' },
  ON_BREAK: { label: 'En almuerzo', tone: 'info' },
  LEFT: { label: 'Ya salió', tone: 'neutral' },
  NOT_ARRIVED: { label: 'No ha llegado', tone: 'critical' },
  NOT_YET: { label: 'Aún no es su hora', tone: 'neutral' },
  ON_LEAVE: { label: 'Permiso', tone: 'info' },
  DAY_OFF: { label: 'Día libre', tone: 'neutral' },
  NO_SCHEDULE: { label: 'Sin horario', tone: 'warning' },
};

export const DEVICE_STATUS: Record<DeviceStatus, { label: string; tone: Tone }> = {
  ONLINE: { label: 'En línea', tone: 'good' },
  SYNCING: { label: 'Sincronizando', tone: 'info' },
  OFFLINE: { label: 'Desconectado', tone: 'critical' },
  ERROR: { label: 'Error', tone: 'serious' },
  DISABLED: { label: 'Deshabilitado', tone: 'neutral' },
};

export const SYNC_STATUS = toned<SyncStatus>(SYNC_STATUS_LABEL, {
  RUNNING: 'info',
  SUCCESS: 'good',
  PARTIAL: 'warning',
  FAILED: 'critical',
});

export const REQUEST_STATUS = toned<RequestStatus>(REQUEST_STATUS_LABEL, {
  PENDING: 'warning',
  APPROVED: 'good',
  REJECTED: 'critical',
  CANCELLED: 'neutral',
});
