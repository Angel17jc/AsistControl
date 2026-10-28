import type {
  AttendanceStatus,
  DeviceStatus,
  PresenceState,
  RequestStatus,
  SyncStatus,
} from '@asistcontrol/shared';
import type { Tone } from './ui';

export const ATTENDANCE_STATUS: Record<AttendanceStatus, { label: string; tone: Tone }> = {
  PRESENT: { label: 'Presente', tone: 'good' },
  LATE: { label: 'Atrasado', tone: 'warning' },
  INCOMPLETE: { label: 'Incompleta', tone: 'serious' },
  ABSENT: { label: 'Ausente', tone: 'critical' },
  ON_LEAVE: { label: 'Permiso', tone: 'info' },
  REST_DAY: { label: 'Día libre', tone: 'neutral' },
  HOLIDAY: { label: 'Feriado', tone: 'neutral' },
  NO_SCHEDULE: { label: 'Sin horario', tone: 'neutral' },
};

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

export const SYNC_STATUS: Record<SyncStatus, { label: string; tone: Tone }> = {
  RUNNING: { label: 'En curso', tone: 'info' },
  SUCCESS: { label: 'Exitosa', tone: 'good' },
  PARTIAL: { label: 'Parcial', tone: 'warning' },
  FAILED: { label: 'Fallida', tone: 'critical' },
};

export const REQUEST_STATUS: Record<RequestStatus, { label: string; tone: Tone }> = {
  PENDING: { label: 'Pendiente', tone: 'warning' },
  APPROVED: { label: 'Aprobada', tone: 'good' },
  REJECTED: { label: 'Rechazada', tone: 'critical' },
  CANCELLED: { label: 'Cancelada', tone: 'neutral' },
};
