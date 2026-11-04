import { DateTime } from 'luxon';
import { DEFAULT_ATTENDANCE_POLICY } from './domain/attendance-policy';
import type { ShiftTemplate } from './domain/work-day';
import { WorkCalendar } from './work-calendar.service';

const TZ = 'America/Guayaquil';
const EMPLOYEE = 'employee-1';
const NIGHT_DATE = '2026-09-21'; // Monday
const MORNING_DATE = '2026-09-22'; // Tuesday

const shift = (id: string, startTime: string, endTime: string): ShiftTemplate => ({
  id,
  startTime,
  endTime,
  breakStart: null,
  breakEnd: null,
  lateToleranceMinutes: null,
  earlyLeaveToleranceMinutes: null,
  overtimeThresholdMinutes: null,
});

const at = (date: string, hhmm: string) =>
  DateTime.fromISO(`${date}T${hhmm}`, { zone: TZ }).toJSDate();

/** Calendar of one employee: weekday (1 = Monday) → shift. */
const calendarOf = (shifts: [number, ShiftTemplate][]) =>
  new WorkCalendar(
    new Map([
      [EMPLOYEE, [{ effectiveFrom: '2026-01-01', effectiveTo: null, shifts: new Map(shifts) }]],
    ]),
    new Set(),
    TZ,
    DEFAULT_ATTENDANCE_POLICY,
  );

describe('WorkCalendar', () => {
  describe('a night shift followed by a morning shift, whose windows overlap', () => {
    // Monday 22:00 → 06:00 runs its window until Tuesday 12:00; Tuesday 08:00 → 17:00 opens at 04:00.
    const calendar = calendarOf([
      [1, shift('night', '22:00', '06:00')],
      [2, shift('morning', '08:00', '17:00')],
    ]);
    const punches = [
      { name: 'exit of the night shift', occurredAt: at(MORNING_DATE, '05:55') },
      { name: 'late exit, nearer the night shift', occurredAt: at(MORNING_DATE, '06:40') },
      { name: 'halfway: the earlier shift wins', occurredAt: at(MORNING_DATE, '07:00') },
      { name: 'early entry, nearer the morning shift', occurredAt: at(MORNING_DATE, '07:40') },
      { name: 'entry of the morning shift', occurredAt: at(MORNING_DATE, '08:05') },
    ];
    const countedBy = (workDate: string) =>
      calendar
        .split(EMPLOYEE, calendar.dayFor(EMPLOYEE, workDate), punches)
        .counted.map((p) => p.name);

    it('gives each punch to the nearer shift', () => {
      expect(calendar.workDateOf(EMPLOYEE, at(MORNING_DATE, '05:55'))).toBe(NIGHT_DATE);
      expect(calendar.workDateOf(EMPLOYEE, at(MORNING_DATE, '08:05'))).toBe(MORNING_DATE);
    });

    it('counts each punch on one day only', () => {
      expect(countedBy(NIGHT_DATE)).toEqual([
        'exit of the night shift',
        'late exit, nearer the night shift',
        'halfway: the earlier shift wins',
      ]);
      expect(countedBy(MORNING_DATE)).toEqual([
        'early entry, nearer the morning shift',
        'entry of the morning shift',
      ]);
    });

    it('does not report as stray a punch another day counts', () => {
      const day = calendar.dayFor(EMPLOYEE, MORNING_DATE);
      expect(calendar.split(EMPLOYEE, day, punches).strays).toEqual([]);
    });
  });

  describe('a shift starting just after midnight', () => {
    // Monday 08:00 → 17:00 closes its window at 23:00; Tuesday 00:30 → 08:30 opens at 20:30 on Monday.
    const calendar = calendarOf([
      [1, shift('office', '08:00', '17:00')],
      [2, shift('dawn', '00:30', '08:30')],
    ]);

    it('takes the entry made before midnight, even after the previous window closed', () => {
      const punch = { occurredAt: at(NIGHT_DATE, '23:50') };
      const monday = calendar.dayFor(EMPLOYEE, NIGHT_DATE);
      const tuesday = calendar.dayFor(EMPLOYEE, MORNING_DATE);
      expect(calendar.workDateOf(EMPLOYEE, punch.occurredAt)).toBe(MORNING_DATE);
      expect(calendar.split(EMPLOYEE, tuesday, [punch]).counted).toEqual([punch]);
      expect(calendar.split(EMPLOYEE, monday, [punch])).toEqual({ counted: [], strays: [] });
    });

    it('gives a punch in both windows to the nearer shift', () => {
      const late = { occurredAt: at(NIGHT_DATE, '20:00') }; // only Monday's window
      const both = { occurredAt: at(NIGHT_DATE, '21:30') }; // 4 h 30 after Monday, 3 h before Tuesday
      expect(calendar.workDateOf(EMPLOYEE, late.occurredAt)).toBe(NIGHT_DATE);
      expect(calendar.workDateOf(EMPLOYEE, both.occurredAt)).toBe(MORNING_DATE);
    });
  });

  it('still reports what no window takes, on its calendar day', () => {
    const calendar = calendarOf([[1, shift('office', '08:00', '17:00')]]);
    const stray = { occurredAt: at(NIGHT_DATE, '23:30') };
    const day = calendar.dayFor(EMPLOYEE, NIGHT_DATE);
    expect(calendar.split(EMPLOYEE, day, [stray])).toEqual({ counted: [], strays: [stray] });
  });
});
