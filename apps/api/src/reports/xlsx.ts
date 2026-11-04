import writeExcelFile, { type Cell, type Sheet } from 'write-excel-file/node';
import type { AttendanceMonth, MonthDay, MonthSheet } from './attendance-month';

const MINUTES_PER_DAY = 24 * 60;
const HOUR_MINUTE = 'hh:mm';
/** Hours past 24 keep adding up: a month's total is not a time of day. */
const DURATION = '[h]:mm';
const DATE = 'dd/mm/yyyy';

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
    ...optional<{ employee: MonthSheet; day: MonthDay }>(month.hasOvertime, {
      header: 'Horas extra',
      width: 12,
      cell: ({ day }) => durationOrEmpty(day.overtimeMinutes),
    }),
    { header: 'Estado', width: 22, cell: ({ day }) => day.status },
    { header: 'Novedades', width: 40, cell: ({ day }) => day.notes || null },
  ];

  const summaryColumns: Column<MonthSheet>[] = [
    { header: 'Código', width: 12, cell: (e) => e.code },
    { header: 'Empleado', width: 32, cell: (e) => e.name },
    ...optional<MonthSheet>(month.hasDepartments, {
      header: 'Departamento',
      width: 20,
      cell: (e) => e.department,
    }),
    { header: 'Días trabajados', width: 15, cell: (e) => e.totals.daysWorked },
    { header: 'Horas trabajadas', width: 16, cell: (e) => duration(e.totals.workedMinutes) },
    ...optional<MonthSheet>(month.hasShortHours, {
      header: 'Horas faltantes',
      width: 15,
      cell: (e) => durationOrEmpty(e.totals.shortMinutes),
    }),
    ...optional<MonthSheet>(month.hasLateness, {
      header: 'Atraso',
      width: 9,
      cell: (e) => durationOrEmpty(e.totals.lateMinutes),
    }),
    ...optional<MonthSheet>(month.hasOvertime, {
      header: 'Horas extra',
      width: 12,
      cell: (e) => durationOrEmpty(e.totals.overtimeMinutes),
    }),
    { header: 'Ausencias', width: 10, cell: (e) => e.totals.absences },
    { header: 'Días con permiso', width: 16, cell: (e) => e.totals.leaveDays },
    { header: 'Días incompletos', width: 16, cell: (e) => e.totals.incomplete },
  ];

  return writeExcelFile([
    sheetOf('Asistencia', days, dayColumns),
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
