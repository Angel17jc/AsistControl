import type { PunchReading, VacationAccrual } from '@asistcontrol/shared';

export {
  ANOMALY_LABEL,
  LEAVE_TYPE_LABEL as LEAVE_LABEL,
  PUNCH_TYPE_LABEL as PUNCH_LABEL,
  formatMinutes,
} from '@asistcontrol/shared';

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

/** "1 sept 2026": for periods that can span years. */
export function formatDateWithYear(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('es-EC', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function todayIso(): string {
  return localDate(new Date().toISOString());
}

/** "2026-09-18": the company's calendar date of an instant. */
export function localDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: displayTimezone }).format(new Date(iso));
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

/** "1 día", "15 días", "7,5 días", "-2 días": balances can be fractional and negative. */
export function formatDays(days: number): string {
  const value = new Intl.NumberFormat('es-EC', { maximumFractionDigits: 2 }).format(days);
  return `${value} ${Math.abs(days) === 1 ? 'día' : 'días'}`;
}

export const VACATION_ACCRUAL_LABEL = {
  ANNUAL: 'Anual, en cada aniversario',
  MONTHLY: 'Mensual, 1/12 por mes',
  CALENDAR_YEAR: 'Por año calendario, cada 1 de enero',
} as const;

export const VACATION_COUNTING_LABEL = {
  WORKING_DAYS: 'Días hábiles',
  CALENDAR_DAYS: 'Días corridos',
} as const;

/**
 * "No caducan", "3 meses después del 31 de diciembre", "24 meses después de cada aniversario":
 * the months count from the end of the year the days were earned in, which depends on accrual.
 */
export function describeExpiry(months: number | null, accrual: VacationAccrual): string {
  if (months === null) return 'No caducan';
  const from = accrual === 'CALENDAR_YEAR' ? 'del 31 de diciembre' : 'de cada aniversario';
  return `${months} ${months === 1 ? 'mes' : 'meses'} después ${from}`;
}

/** How the attendance calculation read a punch of the day. */
export const READING_LABEL: Record<PunchReading, string> = {
  CHECK_IN: 'Entrada',
  BREAK_OUT: 'Salida almuerzo',
  BREAK_IN: 'Regreso',
  CHECK_OUT: 'Salida',
  DUPLICATE: 'Repetida: no cuenta',
  OTHER_DAY: 'Fuera de esta jornada',
};
