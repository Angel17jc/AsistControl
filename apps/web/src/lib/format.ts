import { formatMinutes } from '@asistcontrol/shared';

export { formatMinutes };

const TZ = 'America/Guayaquil';

/** Company timezone comes from the API; this is only the display fallback. */
let displayTimezone = TZ;
export function setDisplayTimezone(tz: string) {
  displayTimezone = tz;
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-EC', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: displayTimezone,
  }).format(new Date(iso));
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-EC', {
    dateStyle: 'short',
    timeStyle: 'short',
    hour12: false,
    timeZone: displayTimezone,
  }).format(new Date(iso));
}

export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('es-EC', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: displayTimezone }).format(new Date());
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'nunca';
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'hace instantes';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

export const PUNCH_LABEL: Record<string, string> = {
  CHECK_IN: 'Entrada',
  CHECK_OUT: 'Salida',
  BREAK_OUT: 'Salida almuerzo',
  BREAK_IN: 'Regreso',
  UNKNOWN: 'Marcación',
};

export const ANOMALY_LABEL: Record<string, string> = {
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
};
