import writeExcelFile, { type Cell, type Sheet } from 'write-excel-file/node';
import type {
  AttendanceMonth,
  MonthDay,
  MonthSheet,
  MonthWeek,
  PeriodTotals,
} from './attendance-month';

const MINUTES_PER_DAY = 24 * 60;
const HOUR_MINUTE = 'hh:mm';
/** Hours past 24 keep adding up: a month's total is not a time of day. */
const DURATION = '[h]:mm';
const DATE = 'dd/mm/yyyy';
const MINUS = '\u2212';

const header = (text: string): Cell => ({ value: text, fontWeight: 'bold' });
const minutesOfDay = (hhmm: string) => {
  const [hours = 0, minutes = 0] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
};
/** Real times and durations, so a spreadsheet can sort and add them. */
const time = (hhmm: string | null): Cell =>
  hhmm === null
    ? null
    : { value: minutesOfDay(hhmm) / MINUTES_PER_DAY, type: Number, format: HOUR_MINUTE };
const duration = (minutes: number): Cell => ({
  value: minutes / MINUTES_PER_DAY,
  type: Number,
  format: DURATION,
});
const durationOrEmpty = (minutes: number): Cell => (minutes > 0 ? duration(minutes) : null);
/**
 * A difference keeps its sign as text ("+0:10", or 7:44 with a minus sign), written like the
 * durations beside it: a spreadsheet shows a negative duration as ####. The hours worked and
 * expected stay real durations for whoever wants to add them.
 */
function difference(minutes: number | null): Cell {
  if (minutes === null) return null;
  const whole = Math.abs(Math.round(minutes));
  const sign = minutes > 0 ? '+' : minutes < 0 ? MINUS : '';
  const text = `${sign}${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  return { value: text, align: 'right' };
}
const date = (isoDate: string): Cell => ({
  value: new Date(`${isoDate}T00:00:00Z`),
  type: Date,
  format: DATE,
});

interface Column<T> {
  header: string;
  width: number;
  cell: (row: T) => Cell;
}

function sheetOf<T>(name: string, rows: T[], columns: Column<T>[]): Sheet<never> {
  return {
    sheet: name,
    data: [columns.map((c) => header(c.header)), ...rows.map((r) => columns.map((c) => c.cell(r)))],
    columns: columns.map((c) => ({ width: c.width })),
    stickyRowsCount: 1,
  };
}

/** The month of each person: every day on one sheet, the totals of each person on another. */
export function attendanceMonthXlsx(month: AttendanceMonth): Promise<Buffer> {
  const optional = <T>(condition: boolean, ...columns: Column<T>[]) => (condition ? columns : []);

  const days = month.employees.flatMap((employee) =>
    employee.days.map((day) => ({ employee, day })),
  );
  const dayColumns: Column<{ employee: MonthSheet; day: MonthDay }>[] = [
    { header: 'Fecha', width: 12, cell: ({ day }) => date(day.date) },
    { header: 'Día', width: 6, cell: ({ day }) => day.weekday },
    { header: 'Código', width: 12, cell: ({ employee }) => employee.code },
    { header: 'Empleado', width: 32, cell: ({ employee }) => employee.name },
    ...optional<{ employee: MonthSheet; day: MonthDay }>(month.hasDepartments, {
      header: 'Departamento',
      width: 20,
      cell: ({ employee }) => employee.department,
    }),
    { header: 'Entrada', width: 9, cell: ({ day }) => time(day.entry) },
    { header: 'Salida almuerzo', width: 15, cell: ({ day }) => time(day.lunchOut) },
    { header: 'Regreso almuerzo', width: 16, cell: ({ day }) => time(day.lunchBack) },
    { header: 'Salida', width: 9, cell: ({ day }) => time(day.exit) },
    {
      header: 'Horas trabajadas',
      width: 16,
      cell: ({ day }) => (day.entry ? duration(day.workedMinutes) : null),
    },
    ...optional<{ employee: MonthSheet; day: MonthDay }>(
      month.hasExpected,
      {
        header: 'Horas esperadas',
        width: 15,
        cell: ({ day }) => durationOrEmpty(day.expectedMinutes),
      },
      { header: 'Diferencia', width: 11, cell: ({ day }) => difference(day.differenceMinutes) },
    ),
    ...optional<{ employee: MonthSheet; day: MonthDay }>(month.hasShortHours, {
      header: 'Horas faltantes',
      width: 15,
      cell: ({ day }) => durationOrEmpty(day.shortMinutes),
    }),
    ...optional<{ employee: MonthSheet; day: MonthDay }>(month.hasLateness, {
      header: 'Atraso',
      width: 9,
      cell: ({ day }) => durationOrEmpty(day.lateMinutes),
    }),
    ...optional<{ employee: MonthSheet; day: MonthDay }>(month.hasLongBreaks, {
      header: 'Almuerzo largo',
      width: 14,
      cell: ({ day }) => durationOrEmpty(day.longBreakMinutes),
    }),
    ...optional<{ employee: MonthSheet; day: MonthDay }>(month.hasOvertime, {
      header: 'Horas extra',
      width: 12,
      cell: ({ day }) => durationOrEmpty(day.overtimeMinutes),
    }),
    { header: 'Estado', width: 22, cell: ({ day }) => day.status },
    { header: 'Novedades', width: 40, cell: ({ day }) => day.notes || null },
  ];

  /** The hours of a person's month or of one of their weeks: the same columns for both. */
  const hourColumns = <T>(totals: (row: T) => PeriodTotals): Column<T>[] => [
    { header: 'Días trabajados', width: 15, cell: (r) => totals(r).daysWorked },
    { header: 'Horas trabajadas', width: 16, cell: (r) => duration(totals(r).workedMinutes) },
    ...optional<T>(
      month.hasExpected,
      {
        header: 'Horas esperadas',
        width: 15,
        cell: (r) => duration(totals(r).expectedMinutes),
      },
      { header: 'Diferencia', width: 11, cell: (r) => difference(totals(r).differenceMinutes) },
    ),
    ...optional<T>(month.hasShortHours, {
      header: 'Horas faltantes',
      width: 15,
      cell: (r) => durationOrEmpty(totals(r).shortMinutes),
    }),
    ...optional<T>(month.hasLateness, {
      header: 'Atraso',
      width: 9,
      cell: (r) => durationOrEmpty(totals(r).lateMinutes),
    }),
    ...optional<T>(month.hasLongBreaks, {
      header: 'Almuerzo largo',
      width: 14,
      cell: (r) => durationOrEmpty(totals(r).longBreakMinutes),
    }),
    ...optional<T>(month.hasOvertime, {
      header: 'Horas extra',
      width: 12,
      cell: (r) => durationOrEmpty(totals(r).overtimeMinutes),
    }),
  ];
  const personColumns = <T>(person: (row: T) => MonthSheet): Column<T>[] => [
    { header: 'Código', width: 12, cell: (r) => person(r).code },
    { header: 'Empleado', width: 32, cell: (r) => person(r).name },
    ...optional<T>(month.hasDepartments, {
      header: 'Departamento',
      width: 20,
      cell: (r) => person(r).department,
    }),
  ];

  const summaryColumns: Column<MonthSheet>[] = [
    ...personColumns<MonthSheet>((e) => e),
    ...hourColumns<MonthSheet>((e) => e.totals),
    { header: 'Ausencias', width: 10, cell: (e) => e.totals.absences },
    { header: 'Días con permiso', width: 16, cell: (e) => e.totals.leaveDays },
    { header: 'Días incompletos', width: 16, cell: (e) => e.totals.incomplete },
  ];

  const weeks = month.employees.flatMap((employee) =>
    employee.weeks.map((week) => ({ employee, week })),
  );
  const weekColumns: Column<{ employee: MonthSheet; week: MonthWeek }>[] = [
    ...personColumns<{ employee: MonthSheet; week: MonthWeek }>(({ employee }) => employee),
    { header: 'Desde', width: 12, cell: ({ week }) => date(week.from) },
    { header: 'Hasta', width: 12, cell: ({ week }) => date(week.to) },
    ...hourColumns<{ employee: MonthSheet; week: MonthWeek }>(({ week }) => week),
  ];

  return writeExcelFile([
    sheetOf('Asistencia', days, dayColumns),
    sheetOf('Semanas', weeks, weekColumns),
    sheetOf('Resumen', month.employees, summaryColumns),
  ]).toBuffer();
}

/** Any other report: its flat rows as they are, with words for headers. */
export function rowsXlsx(
  name: string,
  rows: Record<string, string | number | boolean | null>[],
): Promise<Buffer> {
  const keys = Object.keys(rows[0] ?? {});
  const columns: Column<(typeof rows)[number]>[] = keys.map((key) => ({
    header: wordsOf(key),
    width: Math.max(wordsOf(key).length + 2, 12),
    cell: (row) => row[key] ?? null,
  }));
  return writeExcelFile([sheetOf(name, rows, columns)]).toBuffer();
}

/** "minutos_trabajados" → "Minutos trabajados" */
function wordsOf(key: string): string {
  const words = key.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
