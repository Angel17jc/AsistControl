import type { PunchType } from '@asistcontrol/shared';
import { DateTime } from 'luxon';
import { calculateAttendance, dropDoublePresses, pairByPunchType } from './attendance-calculator';
import { type AttendancePolicy, DEFAULT_ATTENDANCE_POLICY } from './attendance-policy';
import type { CalculationInput, LeaveInterval, Punch } from './types';
import { type ShiftTemplate, assignWorkDate, buildWorkDay } from './work-day';

const TZ = 'America/Guayaquil'; // UTC-5, no DST
const DATE = '2026-09-21';

const DAY_SHIFT: ShiftTemplate = {
  id: 'shift-day',
  startTime: '08:00',
  endTime: '17:00',
  breakStart: '12:00',
  breakEnd: '13:00',
  lateToleranceMinutes: null,
  earlyLeaveToleranceMinutes: null,
  overtimeThresholdMinutes: null,
};

const NIGHT_SHIFT: ShiftTemplate = {
  ...DAY_SHIFT,
  id: 'shift-night',
  startTime: '22:00',
  endTime: '06:00',
  breakStart: '02:00',
  breakEnd: '02:30',
};

/** Local wall-clock time on DATE (or another date) → instant. */
const t = (hhmm: string, date = DATE) =>
  DateTime.fromISO(`${date}T${hhmm}`, { zone: TZ }).toJSDate();

let seq = 0;
const punch = (hhmm: string, type: PunchType = 'UNKNOWN', date = DATE): Punch => ({
  id: `p${++seq}`,
  at: t(hhmm, date),
  type,
});

interface Scenario {
  punches: Punch[];
  template?: ShiftTemplate | null;
  policy?: Partial<AttendancePolicy>;
  leaves?: LeaveInterval[];
  isHoliday?: boolean;
  hasSchedule?: boolean;
  now?: Date;
  date?: string;
}

function run(s: Scenario) {
  const policy = { ...DEFAULT_ATTENDANCE_POLICY, ...s.policy };
  const template = s.template === undefined ? DAY_SHIFT : s.template;
  const day = buildWorkDay({
    workDate: s.date ?? DATE,
    timezone: TZ,
    policy,
    template,
    isHoliday: s.isHoliday ?? false,
    hasSchedule: s.hasSchedule ?? true,
  });
  const input: CalculationInput = {
    day,
    punches: s.punches,
    leaves: s.leaves ?? [],
    policy,
    // By default evaluate once the day is over.
    now: s.now ?? new Date(day.window.to.getTime() + 1),
  };
  return calculateAttendance(input);
}

/** Strict policy used by the specification example: no tolerances. */
const STRICT: Partial<AttendancePolicy> = {
  lateToleranceMinutes: 0,
  overtimeThresholdMinutes: 0,
};

describe('calculateAttendance', () => {
  describe('regular day', () => {
    it('computes the specification example (08:01 / 12:00 / 13:00 / 17:05)', () => {
      const r = run({
        punches: [punch('08:01'), punch('12:00'), punch('13:00'), punch('17:05')],
        policy: STRICT,
      });
      // 08:01→12:00 = 3h59m, 13:00→17:05 = 4h05m
      expect(r.workedMinutes).toBe(8 * 60 + 4);
      expect(r.breakMinutes).toBe(60);
      expect(r.lateMinutes).toBe(1);
      expect(r.overtimeMinutes).toBe(5);
      expect(r.overtimeKind).toBe('REGULAR');
      expect(r.status).toBe('LATE');
      expect(r.anomalies).toEqual(expect.arrayContaining(['LATE_ARRIVAL', 'OVERTIME']));
      expect(r.segments).toHaveLength(2);
      expect(r.isFinal).toBe(true);
    });

    it('is PRESENT with no anomalies for a punctual day', () => {
      const r = run({ punches: [punch('07:55'), punch('12:00'), punch('13:00'), punch('17:00')] });
      expect(r.status).toBe('PRESENT');
      expect(r.anomalies).toEqual([]);
      expect(r.workedMinutes).toBe(8 * 60 + 5);
      expect(r.lateMinutes).toBe(0);
    });

    it('does not flag lateness within the tolerance', () => {
      const r = run({ punches: [punch('08:05'), punch('17:00')] });
      expect(r.lateMinutes).toBe(0);
      expect(r.status).toBe('PRESENT');
    });

    it('counts the full delay once the tolerance is exceeded', () => {
      const r = run({ punches: [punch('08:06'), punch('12:00'), punch('13:00'), punch('17:00')] });
      expect(r.lateMinutes).toBe(6);
      expect(r.status).toBe('LATE');
    });

    it('lets a shift override the global late tolerance', () => {
      const r = run({
        template: { ...DAY_SHIFT, lateToleranceMinutes: 15 },
        punches: [punch('08:10'), punch('17:00')],
      });
      expect(r.lateMinutes).toBe(0);
    });

    it('detects early leave', () => {
      const r = run({ punches: [punch('08:00'), punch('12:00'), punch('13:00'), punch('16:20')] });
      expect(r.earlyLeaveMinutes).toBe(40);
      expect(r.anomalies).toContain('EARLY_LEAVE');
    });

    it('ignores overtime below the threshold', () => {
      const r = run({ punches: [punch('08:00'), punch('12:00'), punch('13:00'), punch('17:10')] });
      expect(r.overtimeMinutes).toBe(0);
      expect(r.anomalies).not.toContain('OVERTIME');
    });

    it('recognizes overtime past the threshold', () => {
      const r = run({ punches: [punch('08:00'), punch('12:00'), punch('13:00'), punch('18:30')] });
      expect(r.overtimeMinutes).toBe(90);
    });

    it('does not count early arrival as overtime unless configured', () => {
      const punches = [punch('07:00'), punch('12:00'), punch('13:00'), punch('17:00')];
      expect(run({ punches }).overtimeMinutes).toBe(0);
      expect(run({ punches, policy: { countEarlyArrivalAsOvertime: true } }).overtimeMinutes).toBe(
        60,
      );
    });

    it('supports the EXCESS_WORKED_TIME basis (late arrivals compensated first)', () => {
      const punches = [punch('09:00'), punch('12:00'), punch('13:00'), punch('18:30')];
      expect(run({ punches }).overtimeMinutes).toBe(90);
      // worked 8h30 vs 8h scheduled → 30 min
      expect(
        run({ punches, policy: { overtimeBasis: 'EXCESS_WORKED_TIME' } }).overtimeMinutes,
      ).toBe(30);
    });
  });

  describe('breaks', () => {
    it('auto-deducts the scheduled break when the employee did not punch for lunch', () => {
      const r = run({ punches: [punch('08:00'), punch('17:00')] });
      expect(r.workedMinutes).toBe(8 * 60);
      expect(r.breakMinutes).toBe(60);
    });

    it('keeps the full span when auto-deduction is disabled', () => {
      const r = run({
        punches: [punch('08:00'), punch('17:00')],
        policy: { autoDeductUnpunchedBreak: false },
      });
      expect(r.workedMinutes).toBe(9 * 60);
    });

    it('flags breaks shorter than the configured minimum', () => {
      const r = run({
        punches: [punch('08:00'), punch('12:00'), punch('12:20'), punch('17:00')],
        policy: { minBreakMinutes: 30 },
      });
      expect(r.breakMinutes).toBe(20);
      expect(r.anomalies).toContain('SHORT_BREAK');
    });
  });

  describe('duplicates and multiple punches', () => {
    it('collapses two identical punches', () => {
      const a = punch('08:00');
      const r = run({ punches: [a, { ...a, id: 'dup' }, punch('17:00')] });
      expect(r.ignoredPunchIds).toEqual(['dup']);
      expect(r.anomalies).toContain('DUPLICATE_PUNCH');
      expect(r.status).toBe('PRESENT');
    });

    it('collapses a double press seconds apart', () => {
      const first = punch('08:00');
      const second: Punch = {
        id: 'double',
        at: new Date(first.at.getTime() + 20_000),
        type: 'UNKNOWN',
      };
      const r = run({ punches: [first, second, punch('12:00'), punch('13:00'), punch('17:00')] });
      expect(r.ignoredPunchIds).toEqual(['double']);
      expect(r.segments).toHaveLength(2);
    });

    it('accepts punches in any order', () => {
      const r = run({ punches: [punch('17:00'), punch('13:00'), punch('08:00'), punch('12:00')] });
      expect(r.firstIn).toEqual(t('08:00'));
      expect(r.lastOut).toEqual(t('17:00'));
    });

    it('handles more than two segments (errand in the afternoon)', () => {
      const r = run({
        punches: [
          punch('08:00'),
          punch('12:00'),
          punch('13:00'),
          punch('15:00'),
          punch('15:30'),
          punch('17:00'),
        ],
      });
      expect(r.segments).toHaveLength(3);
      expect(r.breakMinutes).toBe(90);
      expect(r.workedMinutes).toBe(7 * 60 + 30);
    });
  });

  describe('incomplete days', () => {
    it('flags entry without exit once the day is closed', () => {
      const r = run({ punches: [punch('08:00')] });
      expect(r.status).toBe('INCOMPLETE');
      expect(r.anomalies).toContain('MISSING_CHECK_OUT');
      expect(r.workedMinutes).toBe(0);
    });

    it('treats an open segment as "still working" while the day is in progress', () => {
      const r = run({ punches: [punch('08:00')], now: t('10:00') });
      expect(r.status).toBe('PRESENT');
      expect(r.anomalies).not.toContain('MISSING_CHECK_OUT');
      expect(r.isFinal).toBe(false);
    });

    it('does not report early leave while the employee is at lunch', () => {
      const r = run({ punches: [punch('08:00'), punch('12:00')], now: t('12:30') });
      expect(r.earlyLeaveMinutes).toBe(0);
    });

    it('flags exit without entry when pairing by device punch type', () => {
      const r = run({
        punches: [punch('17:00', 'CHECK_OUT')],
        policy: { punchPairing: 'DEVICE_TYPE' },
      });
      expect(r.status).toBe('INCOMPLETE');
      expect(r.anomalies).toContain('MISSING_CHECK_IN');
      expect(r.lateMinutes).toBe(0);
    });

    it('in sequential mode a lone punch is an entry', () => {
      const r = run({ punches: [punch('17:00', 'CHECK_OUT')] });
      expect(r.anomalies).toContain('MISSING_CHECK_OUT');
    });
  });

  describe('absence, leave and non-working days', () => {
    it('marks ABSENT on a workday without punches', () => {
      expect(run({ punches: [] }).status).toBe('ABSENT');
    });

    it('marks ON_LEAVE when an approved leave covers the shift', () => {
      const r = run({ punches: [], leaves: [{ id: 'l1', start: t('00:00'), end: t('23:59') }] });
      expect(r.status).toBe('ON_LEAVE');
    });

    it('is still ABSENT when the leave only covers part of the shift', () => {
      const r = run({ punches: [], leaves: [{ id: 'l1', start: t('08:00'), end: t('10:00') }] });
      expect(r.status).toBe('ABSENT');
    });

    it('moves the expected arrival after a morning permission', () => {
      const r = run({
        punches: [punch('10:10'), punch('17:00')],
        leaves: [{ id: 'l1', start: t('08:00'), end: t('10:00') }],
      });
      expect(r.lateMinutes).toBe(10);
    });

    it('does not flag early leave for an afternoon permission', () => {
      const r = run({
        punches: [punch('08:00'), punch('15:00')],
        leaves: [{ id: 'l1', start: t('15:00'), end: t('17:00') }],
      });
      expect(r.earlyLeaveMinutes).toBe(0);
    });

    it('marks REST_DAY when the schedule has no shift that weekday', () => {
      expect(run({ punches: [], template: null }).status).toBe('REST_DAY');
    });

    it('counts all work on a rest day as rest-day overtime', () => {
      const r = run({ punches: [punch('09:00'), punch('13:00')], template: null });
      expect(r.status).toBe('REST_DAY');
      expect(r.overtimeMinutes).toBe(240);
      expect(r.overtimeKind).toBe('REST_DAY');
      expect(r.anomalies).toContain('WORKED_ON_REST_DAY');
    });

    it('treats holidays as non-working days even when the schedule has a shift', () => {
      expect(run({ punches: [], isHoliday: true }).status).toBe('HOLIDAY');
      const worked = run({ punches: [punch('08:00'), punch('12:00')], isHoliday: true });
      expect(worked.overtimeKind).toBe('HOLIDAY');
      expect(worked.overtimeMinutes).toBe(240);
    });

    it('reports NO_SCHEDULE for employees without a schedule and never computes lateness', () => {
      const r = run({
        punches: [punch('10:00'), punch('18:00')],
        template: null,
        hasSchedule: false,
      });
      expect(r.status).toBe('NO_SCHEDULE');
      expect(r.workedMinutes).toBe(480);
      expect(r.lateMinutes).toBe(0);
      expect(r.overtimeMinutes).toBe(0);
    });
  });

  describe('out of schedule', () => {
    it('flags punches far outside the shift', () => {
      const r = run({ punches: [punch('04:30'), punch('17:00')] });
      expect(r.anomalies).toContain('OUT_OF_SCHEDULE_PUNCH');
    });

    it('ignores punches outside the work day window', () => {
      const r = run({ punches: [punch('01:00'), punch('08:00'), punch('17:00')] });
      expect(r.firstIn).toEqual(t('08:00'));
    });
  });

  describe('night shift (22:00 → 06:00)', () => {
    it('evaluates a shift that crosses midnight', () => {
      const r = run({
        template: NIGHT_SHIFT,
        punches: [
          punch('22:03'),
          punch('02:00', 'UNKNOWN', '2026-09-22'),
          punch('02:30', 'UNKNOWN', '2026-09-22'),
          punch('06:20', 'UNKNOWN', '2026-09-22'),
        ],
      });
      expect(r.lateMinutes).toBe(0);
      expect(r.workedMinutes).toBe(3 * 60 + 57 + 3 * 60 + 50);
      expect(r.overtimeMinutes).toBe(20);
      expect(r.status).toBe('PRESENT');
    });

    it('assigns a 02:00 punch to the previous work day', () => {
      const policy = DEFAULT_ATTENDANCE_POLICY;
      const previous = buildWorkDay({
        workDate: '2026-09-21',
        timezone: TZ,
        policy,
        template: NIGHT_SHIFT,
        isHoliday: false,
        hasSchedule: true,
      });
      const current = buildWorkDay({
        workDate: '2026-09-22',
        timezone: TZ,
        policy,
        template: NIGHT_SHIFT,
        isHoliday: false,
        hasSchedule: true,
      });
      expect(assignWorkDate(t('02:00', '2026-09-22'), previous, current)).toBe('2026-09-21');
      expect(assignWorkDate(t('21:55', '2026-09-22'), previous, current)).toBe('2026-09-22');
    });

    it('keeps day-shift punches on their calendar day', () => {
      const policy = DEFAULT_ATTENDANCE_POLICY;
      const previous = buildWorkDay({
        workDate: '2026-09-20',
        timezone: TZ,
        policy,
        template: DAY_SHIFT,
        isHoliday: false,
        hasSchedule: true,
      });
      const current = buildWorkDay({
        workDate: '2026-09-21',
        timezone: TZ,
        policy,
        template: DAY_SHIFT,
        isHoliday: false,
        hasSchedule: true,
      });
      expect(assignWorkDate(t('07:58'), previous, current)).toBe('2026-09-21');
    });
  });
});

describe('dropDoublePresses', () => {
  it('keeps punches exactly at the window boundary', () => {
    const a = punch('08:00');
    const b: Punch = { id: 'b', at: new Date(a.at.getTime() + 60_000), type: 'UNKNOWN' };
    expect(dropDoublePresses([a, b], 60).kept).toHaveLength(2);
  });

  it('disables deduplication with a zero window', () => {
    const a = punch('08:00');
    expect(dropDoublePresses([a, { ...a, id: 'x' }], 0).kept).toHaveLength(2);
  });
});

describe('pairByPunchType', () => {
  it('closes an unmatched entry when a new entry arrives', () => {
    const segments = pairByPunchType([
      punch('08:00', 'CHECK_IN'),
      punch('13:00', 'CHECK_IN'),
      punch('17:00', 'CHECK_OUT'),
    ]);
    expect(segments).toEqual([
      { in: t('08:00'), out: null },
      { in: t('13:00'), out: t('17:00') },
    ]);
  });

  it('infers UNKNOWN punches from the current state', () => {
    const segments = pairByPunchType([
      punch('08:00'),
      punch('12:00'),
      punch('13:00', 'BREAK_IN'),
      punch('17:00'),
    ]);
    expect(segments).toHaveLength(2);
    expect(segments.every((s) => s.in && s.out)).toBe(true);
  });
});
