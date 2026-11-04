import type {
  AttendanceAnomaly,
  AttendanceStatus,
  EventSource,
  LeaveType,
  OvertimeKind,
  PunchType,
  RequestStatus,
  SyncStatus,
  SyncTrigger,
} from './domain';

/**
 * The Spanish names of the domain's values, one place for all that speak to people: the web,
 * the reports and the emails. A new value does not compile without its name here.
 */
export const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = {
  PRESENT: 'Presente',
  LATE: 'Atrasado',
  INCOMPLETE: 'Incompleta',
  ABSENT: 'Ausente',
  ON_LEAVE: 'Permiso',
  REST_DAY: 'Día libre',
  HOLIDAY: 'Feriado',
  NO_SCHEDULE: 'Sin horario',
};

export const ANOMALY_LABEL: Record<AttendanceAnomaly, string> = {
  LATE_ARRIVAL: 'Atraso',
  EARLY_LEAVE: 'Salida anticipada',
  OVERTIME: 'Horas extra',
  MISSING_CHECK_IN: 'Sin entrada',
  MISSING_CHECK_OUT: 'Sin salida',
  DUPLICATE_PUNCH: 'Marcación duplicada',
  OUT_OF_SCHEDULE_PUNCH: 'Fuera de horario',
  SHORT_BREAK: 'Almuerzo corto',
  WORKED_ON_REST_DAY: 'Trabajó en día libre',
  WORKED_ON_HOLIDAY: 'Trabajó en feriado',
  STRAY_PUNCH: 'Marcación fuera de jornada',
};

export const PUNCH_TYPE_LABEL: Record<PunchType, string> = {
  CHECK_IN: 'Entrada',
  CHECK_OUT: 'Salida',
  BREAK_OUT: 'Salida almuerzo',
  BREAK_IN: 'Regreso',
  UNKNOWN: 'Marcación',
};

export const EVENT_SOURCE_LABEL: Record<EventSource, string> = {
  DEVICE: 'Marcador',
  MANUAL: 'Manual',
  IMPORT: 'Importada',
};

export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  PERSONAL: 'Permiso personal',
  MEDICAL: 'Médico',
  VACATION: 'Vacaciones',
  OTHER: 'Otro',
};

export const OVERTIME_KIND_LABEL: Record<OvertimeKind, string> = {
  REGULAR: 'Ordinaria',
  REST_DAY: 'Día libre',
  HOLIDAY: 'Feriado',
};

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  PENDING: 'Pendiente',
  APPROVED: 'Aprobada',
  REJECTED: 'Rechazada',
  CANCELLED: 'Cancelada',
};

export const SYNC_STATUS_LABEL: Record<SyncStatus, string> = {
  RUNNING: 'En curso',
  SUCCESS: 'Exitosa',
  PARTIAL: 'Parcial',
  FAILED: 'Fallida',
};

export const SYNC_TRIGGER_LABEL: Record<SyncTrigger, string> = {
  MANUAL: 'Manual',
  SCHEDULED: 'Programada',
  REALTIME: 'Tiempo real',
};

const DEVICE_ERROR = new Map([
  ['AUTHENTICATION_FAILED', 'El equipo rechazó las credenciales'],
  ['CONNECTION_FAILED', 'Sin respuesta del equipo: revise la IP, el puerto y la red'],
  ['NOT_CONNECTED', 'Se perdió la conexión con el equipo'],
  ['TIMEOUT', 'El equipo no respondió a tiempo'],
  ['PROTOCOL_ERROR', 'El equipo respondió algo inesperado'],
  ['UNSUPPORTED_DRIVER', 'El driver no está disponible en este servidor'],
  ['UNSUPPORTED_OPERATION', 'Este equipo no admite esa operación'],
]);

/**
 * A device failure in words an operator can act on. The API stores `CODE: detail`: the code
 * decides where to look (network, credentials, configuration) and the detail stays for support.
 */
export function explainDeviceError(error: string | null): string {
  if (!error) return 'Error desconocido';
  const separator = error.indexOf(': ');
  const code = separator === -1 ? error : error.slice(0, separator);
  const reason = DEVICE_ERROR.get(code);
  if (!reason) return error;
  return separator === -1 ? reason : `${reason} (${error.slice(separator + 2)})`;
}
