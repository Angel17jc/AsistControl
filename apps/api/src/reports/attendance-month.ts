import {
  ANOMALY_LABEL,
  ATTENDANCE_STATUS_LABEL,
  type AttendanceAnomaly,
  type AttendanceStatus,
  formatMinutes,
} from '@asistcontrol/shared';
import { DateTime } from 'luxon';
import { eachDate } from '../common/utils/date-only';

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;
const WEEKDAYS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'] as const;

/** Said by their own columns, so the notes do not repeat them. */
const IN_THEIR_OWN_COLUMN = new Set<AttendanceAnomaly>(['SHORT_HOURS', 'OVERTIME', 'LATE_ARRIVAL']);

/** A work day as stored, with only what this document reads. */
export interface MonthRecord {
  /** YYYY-MM-DD */
  date: string;
  status: AttendanceStatus;
  firstIn: Date | null;
  lastOut: Date | null;
  /** Work stretches in order, as ISO instants. */
  segments: { in: string | null; out: string | null }[];
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  shortMinutes: number;
  anomalies: AttendanceAnomaly[];
  isFinal: boolean;
}

export interface MonthEmployee {
  code: string;
  name: string;
  department: string | null;
  /** YYYY-MM-DD */
  hireDate: string;
  terminatedAt: string | null;
  records: MonthRecord[];
}

/** One line of the document. Times are local "HH:mm". */
export interface MonthDay {
  date: string;
  weekday: string;
  entry: string | null;
  lunchOut: string | null;
  lunchBack: string | null;
  exit: string | null;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  shortMinutes: number;
  status: string;
  notes: string;
  /** A rest day or holiday nobody worked: it only completes the calendar. */
  off: boolean;
}

export interface MonthTotals {
  daysWorked: number;
  workedMinutes: number;
  shortMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  absences: number;
  incomplete: number;
  leaveDays: number;
}

export interface MonthSheet {
  code: string;
  name: string;
  department: string | null;
  days: MonthDay[];
  totals: MonthTotals;
}

export interface AttendanceMonth {
  /** "octubre de 2026" */
  title: string;
  /** YYYY-MM */
  month: string;
  employees: MonthSheet[];
  /** Whether any day has it: a company without fixed hours or overtime gets no empty column. */
  hasLateness: boolean;
  hasOvertime: boolean;
  hasShortHours: boolean;
  hasDepartments: boolean;
}

/**
 * The month of each person, day by day: what Human Resources downloads. Pure: the caller
 * loads the records and says which day today is, since days to come have nothing to show.
 */
export function buildAttendanceMonth(params: {
  from: string;
  to: string;
  today: string;
  timezone: string;
  employees: MonthEmployee[];
}): AttendanceMonth {
  const { from, to, today, timezone, employees } = params;
  const sheets = employees.map((employee) => sheetOf(employee, { from, to, today, timezone }));
  const days = sheets.flatMap((s) => s.days);
  const month = from.slice(0, 7);
  return {
    title: monthTitle(month),
    month,
    employees: sheets,
    hasLateness: days.some((d) => d.lateMinutes > 0),
    hasOvertime: days.some((d) => d.overtimeMinutes > 0),
    hasShortHours: days.some((d) => d.shortMinutes > 0),
    hasDepartments: sheets.some((s) => s.department !== null),
  };
}

export function monthTitle(month: string): string {
  const [year, number] = month.split('-');
  return `${MONTHS[Number(number) - 1]} de ${year}`;
}

function sheetOf(
  employee: MonthEmployee,
  range: { from: string; to: string; today: string; timezone: string },
): MonthSheet {
  const { from, to, today, timezone } = range;
  const first = employee.hireDate > from ? employee.hireDate : from;
  let last = to < today ? to : today;
  if (employee.terminatedAt && employee.terminatedAt < last) last = employee.terminatedAt;
  const byDate = new Map(employee.records.map((r) => [r.date, r]));
  const dates = first <= last ? eachDate(first, last) : [];
  const days = dates.map((date) => dayOf(date, byDate.get(date), today, timezone));
  return {
    code: employee.code,
    name: employee.name,
    department: employee.department,
    days,
    totals: totalsOf(days, employee.records),
  };
}

function dayOf(
  date: string,
  record: MonthRecord | undefined,
  today: string,
  timezone: string,
): MonthDay {
  const weekday = weekdayOf(date);
  if (!record) {
    return {
      date,
      weekday,
      entry: null,
      lunchOut: null,
      lunchBack: null,
      exit: null,
      workedMinutes: 0,
      breakMinutes: 0,
      lateMinutes: 0,
      overtimeMinutes: 0,
      shortMinutes: 0,
      // Today may simply not have started; an older day means nothing was ever calculated.
      status: date === today ? 'Sin marcaciones todavía' : 'Sin registro',
      notes: '',
      off: false,
    };
  }

  const time = (iso: string | Date | null) => {
    if (!iso) return null;
    const at = typeof iso === 'string' ? DateTime.fromISO(iso) : DateTime.fromJSDate(iso);
    return at.setZone(timezone).toFormat('HH:mm');
  };
  const { lunch, others } = pausesOf(record.segments);
  const notes = [
    ...record.anomalies.filter((a) => !IN_THEIR_OWN_COLUMN.has(a)).map((a) => ANOMALY_LABEL[a]),
    ...others.map((p) => `Otra pausa ${time(p.out)}–${time(p.back)}`),
    ...(record.isFinal ? [] : ['Día en curso']),
  ];
  const segmented = record.segments.length > 0;
  return {
    date,
    weekday,
    // A return nobody closed shows no exit: the exit before it is a pause, not the day's end.
    entry: time(segmented ? record.segments[0]!.in : record.firstIn),
    lunchOut: lunch ? time(lunch.out) : null,
    lunchBack: lunch ? time(lunch.back) : null,
    exit: time(segmented ? record.segments.at(-1)!.out : record.lastOut),
    workedMinutes: record.workedMinutes,
    breakMinutes: record.breakMinutes,
    lateMinutes: record.lateMinutes,
    overtimeMinutes: record.overtimeMinutes,
    shortMinutes: record.shortMinutes,
    status: ATTENDANCE_STATUS_LABEL[record.status],
    notes: notes.join(' · '),
    off:
      (record.status === 'REST_DAY' || record.status === 'HOLIDAY') && record.workedMinutes === 0,
  };
}

/** The longest pause of a day is its lunch: a shorter one is some other errand. */
export function longestPause(segments: MonthRecord['segments']) {
  return pausesOf(segments).lunch;
}

function pausesOf(segments: MonthRecord['segments']) {
  const pauses: { out: string; back: string }[] = [];
  for (let i = 1; i < segments.length; i++) {
    const out = segments[i - 1]!.out;
    const back = segments[i]!.in;
    if (out && back) pauses.push({ out, back });
  }
  const length = (p: { out: string; back: string }) => Date.parse(p.back) - Date.parse(p.out);
  const lunch = pauses.reduce<(typeof pauses)[number] | null>(
    (longest, p) => (!longest || length(p) > length(longest) ? p : longest),
    null,
  );
  return { lunch, others: pauses.filter((p) => p !== lunch) };
}

function totalsOf(days: MonthDay[], records: MonthRecord[]): MonthTotals {
  const count = (status: AttendanceStatus) => records.filter((r) => r.status === status).length;
  const sum = (pick: (d: MonthDay) => number) => days.reduce((total, d) => total + pick(d), 0);
  return {
    daysWorked: days.filter((d) => d.entry !== null).length,
    workedMinutes: sum((d) => d.workedMinutes),
    shortMinutes: sum((d) => d.shortMinutes),
    lateMinutes: sum((d) => d.lateMinutes),
    overtimeMinutes: sum((d) => d.overtimeMinutes),
    absences: count('ABSENT'),
    incomplete: count('INCOMPLETE'),
    leaveDays: count('ON_LEAVE'),
  };
}

function weekdayOf(isoDate: string): string {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return WEEKDAYS[day === 0 ? 6 : day - 1]!;
}

/** The flat rows shown on screen and written to the CSV: words, one row per person and day. */
export function monthRows(month: AttendanceMonth) {
  return month.employees.flatMap((employee) =>
    employee.days.map((d) => ({
      fecha: d.date,
      dia: d.weekday,
      codigo: employee.code,
      empleado: employee.name,
      ...(month.hasDepartments ? { departamento: employee.department } : {}),
      entrada: d.entry,
      salida_almuerzo: d.lunchOut,
      regreso_almuerzo: d.lunchBack,
      salida: d.exit,
      horas_trabajadas: d.entry ? formatMinutes(d.workedMinutes) : null,
      ...(month.hasShortHours ? { horas_faltantes: minutesOrNull(d.shortMinutes) } : {}),
      ...(month.hasLateness ? { atraso: minutesOrNull(d.lateMinutes) } : {}),
      ...(month.hasOvertime ? { horas_extra: minutesOrNull(d.overtimeMinutes) } : {}),
      estado: d.status,
      novedades: d.notes,
    })),
  );
}

const minutesOrNull = (minutes: number) => (minutes > 0 ? formatMinutes(minutes) : null);
