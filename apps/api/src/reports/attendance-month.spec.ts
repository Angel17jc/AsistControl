import { DateTime } from 'luxon';
import {
  type MonthEmployee,
  type MonthRecord,
  buildAttendanceMonth,
  monthRows,
  monthTitle,
} from './attendance-month';

const TZ = 'America/Guayaquil';
const instant = (date: string, hhmm: string) =>
  DateTime.fromISO(`${date}T${hhmm}`, { zone: TZ }).toUTC().toISO()!;

const worked = (date: string, stretches: [string | null, string | null][]): MonthRecord => {
  const segments = stretches.map(([from, until]) => ({
    in: from && instant(date, from),
    out: until && instant(date, until),
  }));
  return {
    date,
    status: 'PRESENT',
    firstIn: stretches[0]?.[0] ? new Date(instant(date, stretches[0][0])) : null,
    lastOut: null,
    segments,
    workedMinutes: 480,
    breakMinutes: 60,
    lateMinutes: 0,
    overtimeMinutes: 0,
    shortMinutes: 0,
    anomalies: [],
    isFinal: true,
  };
};
const empty = (date: string, status: MonthRecord['status']): MonthRecord => ({
  ...worked(date, []),
  status,
  firstIn: null,
  workedMinutes: 0,
  breakMinutes: 0,
});

const ANA: MonthEmployee = {
  code: 'EMP-1',
  name: 'Vera Ana',
  department: null,
  hireDate: '2026-01-01',
  terminatedAt: null,
  records: [],
};

const build = (employee: Partial<MonthEmployee>, today = '2026-11-04') =>
  buildAttendanceMonth({
    from: '2026-10-01',
    to: '2026-10-31',
    today,
    timezone: TZ,
    employees: [{ ...ANA, ...employee }],
  });
const dayOf = (month: ReturnType<typeof build>, date: string) =>
  month.employees[0]!.days.find((d) => d.date === date)!;

describe('buildAttendanceMonth', () => {
  it('names the month in Spanish', () => {
    expect(build({}).title).toBe('octubre de 2026');
    expect(monthTitle('2026-01')).toBe('enero de 2026');
  });

  it('lists every day of the month, whether or not it has a record', () => {
    const { employees } = build({ records: [worked('2026-10-05', [['08:00', '17:00']])] });
    expect(employees[0]!.days).toHaveLength(31);
    expect(employees[0]!.days[0]).toMatchObject({
      date: '2026-10-01',
      weekday: 'jue',
      status: 'Sin registro',
    });
  });

  it('reads entry, lunch and exit in local time', () => {
    const month = build({
      records: [
        worked('2026-10-05', [
          ['09:00', '13:00'],
          ['14:00', '18:00'],
        ]),
      ],
    });
    expect(dayOf(month, '2026-10-05')).toMatchObject({
      weekday: 'lun',
      entry: '09:00',
      lunchOut: '13:00',
      lunchBack: '14:00',
      exit: '18:00',
      status: 'Presente',
      notes: '',
    });
  });

  it('takes the longest pause as the lunch and notes the others', () => {
    const month = build({
      records: [
        worked('2026-10-05', [
          ['08:00', '10:00'],
          ['10:10', '13:00'],
          ['14:00', '17:00'],
        ]),
      ],
    });
    expect(dayOf(month, '2026-10-05')).toMatchObject({
      lunchOut: '13:00',
      lunchBack: '14:00',
      notes: 'Otra pausa 10:00–10:10',
    });
  });

  it('shows no exit for a return nobody closed', () => {
    const record = {
      ...worked('2026-10-05', [
        ['08:00', '13:00'],
        ['14:00', null],
      ]),
      status: 'INCOMPLETE' as const,
      anomalies: ['MISSING_CHECK_OUT' as const],
    };
    const month = build({ records: [record] });
    expect(dayOf(month, '2026-10-05')).toMatchObject({
      exit: null,
      lunchOut: '13:00',
      status: 'Incompleta',
      notes: 'Sin salida',
    });
    expect(month.employees[0]!.totals.incomplete).toBe(1);
  });

  it('marks a rest day nobody worked as only completing the calendar', () => {
    const rest = empty('2026-10-03', 'REST_DAY');
    const workedRest = {
      ...worked('2026-10-04', [['08:00', '12:00']]),
      status: 'REST_DAY' as const,
    };
    const month = build({ records: [rest, workedRest] });
    expect(dayOf(month, '2026-10-03').off).toBe(true);
    expect(dayOf(month, '2026-10-04').off).toBe(false);
  });

  it('starts at the hire date and ends at the termination', () => {
    const { employees } = build({ hireDate: '2026-10-20', terminatedAt: '2026-10-25' });
    expect(employees[0]!.days.map((d) => d.date)).toEqual([
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ]);
  });

  it('has nothing for someone hired after the month', () => {
    expect(build({ hireDate: '2026-11-01' }).employees[0]!.days).toEqual([]);
  });

  it('stops at today, and says a day in course is one', () => {
    const today = '2026-10-10';
    const record = { ...worked(today, [['08:00', null]]), isFinal: false };
    const { employees } = build({ records: [record] }, today);
    expect(employees[0]!.days).toHaveLength(10);
    expect(employees[0]!.days.at(-1)!.notes).toContain('Día en curso');
    const none = build({}, today).employees[0]!.days.at(-1)!;
    expect(none.status).toBe('Sin marcaciones todavía');
  });

  it('adds up the month', () => {
    const { employees } = build({
      records: [
        { ...worked('2026-10-05', [['08:00', '17:00']]), workedMinutes: 480 },
        { ...worked('2026-10-06', [['09:00', '17:00']]), workedMinutes: 420, shortMinutes: 60 },
        empty('2026-10-07', 'ABSENT'),
        empty('2026-10-08', 'ON_LEAVE'),
      ],
    });
    expect(employees[0]!.totals).toEqual({
      daysWorked: 2,
      workedMinutes: 900,
      shortMinutes: 60,
      lateMinutes: 0,
      overtimeMinutes: 0,
      absences: 1,
      incomplete: 0,
      leaveDays: 1,
    });
  });

  it('says nothing twice: hours short have their own column, not a note', () => {
    const record = {
      ...worked('2026-10-05', [['09:00', '17:00']]),
      shortMinutes: 60,
      anomalies: ['SHORT_HOURS' as const, 'DUPLICATE_PUNCH' as const],
    };
    expect(dayOf(build({ records: [record] }), '2026-10-05').notes).toBe('Marcación duplicada');
  });
});

describe('monthRows', () => {
  it('has a column for what the month has, and none for what it does not', () => {
    const plain = monthRows(build({ records: [worked('2026-10-05', [['08:00', '17:00']])] }));
    expect(Object.keys(plain[0]!)).toEqual([
      'fecha',
      'dia',
      'codigo',
      'empleado',
      'entrada',
      'salida_almuerzo',
      'regreso_almuerzo',
      'salida',
      'horas_trabajadas',
      'estado',
      'novedades',
    ]);
    const full = monthRows(
      build({
        department: 'Ventas',
        records: [
          {
            ...worked('2026-10-05', [['08:30', '19:00']]),
            lateMinutes: 30,
            overtimeMinutes: 120,
            shortMinutes: 15,
          },
        ],
      }),
    );
    expect(full[4]).toMatchObject({
      departamento: 'Ventas',
      atraso: '0h 30m',
      horas_extra: '2h 00m',
      horas_faltantes: '0h 15m',
    });
  });
});
