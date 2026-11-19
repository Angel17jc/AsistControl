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
    expectedMinutes: 480,
    longBreakMinutes: 0,
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
        { ...empty('2026-10-08', 'ON_LEAVE'), expectedMinutes: 0 },
      ],
    });
    expect(employees[0]!.totals).toEqual({
      daysWorked: 2,
      workedMinutes: 900,
      // Three days owed 8 h; the day on leave owed nothing.
      expectedMinutes: 3 * 480,
      differenceMinutes: 900 - 3 * 480,
      shortMinutes: 60,
      lateMinutes: 0,
      longBreakMinutes: 0,
      overtimeMinutes: 0,
      absences: 1,
      incomplete: 0,
      leaveDays: 1,
    });
  });

  it('keeps the account of each closed day against what it expected', () => {
    const today = '2026-10-07';
    const month = build(
      {
        records: [
          { ...worked('2026-10-05', [['08:00', '17:00']]), workedMinutes: 450 },
          { ...empty('2026-10-03', 'REST_DAY'), expectedMinutes: 0 },
          empty('2026-10-06', 'ABSENT'),
          { ...worked(today, [['08:00', null]]), workedMinutes: 120, isFinal: false },
        ],
      },
      today,
    );
    expect(dayOf(month, '2026-10-05').differenceMinutes).toBe(-30);
    expect(dayOf(month, '2026-10-06').differenceMinutes).toBe(-480);
    // A rest day nobody worked, a day without a record and today owe nothing yet.
    expect(dayOf(month, '2026-10-03').differenceMinutes).toBeNull();
    expect(dayOf(month, '2026-10-04').differenceMinutes).toBeNull();
    expect(dayOf(month, today).differenceMinutes).toBeNull();
    expect(month.employees[0]!.totals).toMatchObject({
      workedMinutes: 570,
      expectedMinutes: 960,
      differenceMinutes: -510,
    });
  });

  it('adds up each week from Monday to Sunday, cut to the month', () => {
    const { employees } = build({
      records: [
        { ...worked('2026-10-02', [['08:00', '17:00']]), workedMinutes: 500 },
        { ...worked('2026-10-05', [['08:00', '17:00']]), lateMinutes: 12 },
        {
          ...worked('2026-10-11', [['08:00', '12:00']]),
          status: 'REST_DAY',
          workedMinutes: 240,
          expectedMinutes: 0,
        },
        { ...worked('2026-10-12', [['08:00', '17:00']]), longBreakMinutes: 25, workedMinutes: 455 },
      ],
    });
    const weeks = employees[0]!.weeks;
    expect(weeks.map((w) => [w.from, w.to])).toEqual([
      ['2026-10-01', '2026-10-04'],
      ['2026-10-05', '2026-10-11'],
      ['2026-10-12', '2026-10-18'],
      ['2026-10-19', '2026-10-25'],
      ['2026-10-26', '2026-10-31'],
    ]);
    expect(weeks[0]).toMatchObject({
      workedMinutes: 500,
      expectedMinutes: 480,
      differenceMinutes: 20,
    });
    // The Sunday worked counts in its week, all of it over.
    expect(weeks[1]).toMatchObject({
      daysWorked: 2,
      workedMinutes: 720,
      expectedMinutes: 480,
      differenceMinutes: 240,
      lateMinutes: 12,
    });
    expect(weeks[2]).toMatchObject({ longBreakMinutes: 25, differenceMinutes: -25 });
    expect(weeks[3]).toMatchObject({ workedMinutes: 0, expectedMinutes: 0, differenceMinutes: 0 });
  });

  it('says nothing twice: hours short and long lunches have their own column, not a note', () => {
    const record = {
      ...worked('2026-10-05', [['09:00', '17:00']]),
      shortMinutes: 60,
      longBreakMinutes: 20,
      anomalies: ['SHORT_HOURS' as const, 'LONG_BREAK' as const, 'DUPLICATE_PUNCH' as const],
    };
    expect(dayOf(build({ records: [record] }), '2026-10-05').notes).toBe('Marcación duplicada');
  });
});

describe('monthRows', () => {
  it('has a column for what the month has, and none for what it does not', () => {
    // Without a schedule nothing is expected, so there is no difference to show either.
    const plain = monthRows(
      build({ records: [{ ...worked('2026-10-05', [['08:00', '17:00']]), expectedMinutes: 0 }] }),
    );
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
            workedMinutes: 525,
            longBreakMinutes: 20,
          },
        ],
      }),
    );
    expect(full[4]).toMatchObject({
      departamento: 'Ventas',
      horas_esperadas: '8h 00m',
      diferencia: '+0h 45m',
      almuerzo_largo: '0h 20m',
      atraso: '0h 30m',
      horas_extra: '2h 00m',
      horas_faltantes: '0h 15m',
    });
  });
});
