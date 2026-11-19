import { describe, expect, it } from 'vitest';
import { breaksOf, differenceOf, timecardTotals, weeksOf } from './timecard';
import type { AttendanceRecordRow } from './types';

const record = (rest: Partial<AttendanceRecordRow>): AttendanceRecordRow =>
  ({
    status: 'PRESENT',
    firstIn: '2026-10-01T13:00:00.000Z',
    workedMinutes: 480,
    expectedMinutes: 480,
    lateMinutes: 0,
    longBreakMinutes: 0,
    earlyLeaveMinutes: 0,
    overtimeMinutes: 0,
    shortMinutes: 0,
    anomalies: [],
    isFinal: true,
    ...rest,
  }) as AttendanceRecordRow;

describe('breaksOf', () => {
  it('pairs each exit with the next return', () => {
    expect(
      breaksOf([
        { in: '08:00', out: '12:00' },
        { in: '13:00', out: '15:00' },
        { in: '15:20', out: '17:00' },
      ]),
    ).toEqual([
      { out: '12:00', back: '13:00' },
      { out: '15:00', back: '15:20' },
    ]);
  });

  it('has no pause for a single stretch or a missing punch', () => {
    expect(breaksOf([{ in: '08:00', out: '17:00' }])).toEqual([]);
    expect(
      breaksOf([
        { in: '08:00', out: null },
        { in: '13:00', out: '17:00' },
      ]),
    ).toEqual([]);
  });
});

describe('timecardTotals', () => {
  it('adds up a period for one person', () => {
    const totals = timecardTotals([
      record({ lateMinutes: 12, workedMinutes: 468 }),
      record({ overtimeMinutes: 90, workedMinutes: 570, anomalies: ['OVERTIME', 'STRAY_PUNCH'] }),
      record({ status: 'INCOMPLETE', earlyLeaveMinutes: 30, workedMinutes: 0 }),
      record({ status: 'ABSENT', firstIn: null, workedMinutes: 0 }),
      record({ status: 'REST_DAY', firstIn: null, workedMinutes: 0, expectedMinutes: 0 }),
      record({ longBreakMinutes: 25, workedMinutes: 455 }),
      record({ workedMinutes: 120, isFinal: false }),
    ]);
    expect(totals).toEqual({
      daysWorked: 5,
      workedMinutes: 1613,
      // Five closed workdays expected 8 h each; today is still open.
      expectedMinutes: 5 * 480,
      differenceMinutes: 1493 - 5 * 480,
      openDays: 1,
      lateDays: 1,
      lateMinutes: 12,
      longBreakDays: 1,
      longBreakMinutes: 25,
      earlyLeaveMinutes: 30,
      overtimeMinutes: 90,
      shortMinutes: 0,
      absences: 1,
      incomplete: 1,
      strayDays: 1,
    });
  });
});

describe('weeksOf', () => {
  it('groups the days Monday to Sunday and adds up each week', () => {
    const day = (workDate: string, rest: Partial<AttendanceRecordRow> = {}) =>
      record({ workDate, ...rest });
    const weeks = weeksOf([
      day('2026-09-30', { workedMinutes: 500 }),
      day('2026-10-02'),
      // A Sunday belongs to the week that started on Monday.
      day('2026-10-04', { workedMinutes: 240, expectedMinutes: 0 }),
      day('2026-10-05', { lateMinutes: 12, workedMinutes: 468 }),
    ]);
    expect(weeks.map((w) => [w.from, w.to])).toEqual([
      ['2026-09-30', '2026-10-04'],
      ['2026-10-05', '2026-10-05'],
    ]);
    expect(weeks[0]!.totals).toMatchObject({
      workedMinutes: 1220,
      expectedMinutes: 960,
      differenceMinutes: 260,
    });
    expect(weeks[1]!.totals).toMatchObject({ lateMinutes: 12, differenceMinutes: -12 });
  });
});

describe('differenceOf', () => {
  it('compares a closed day with what was expected', () => {
    expect(differenceOf(record({ workedMinutes: 450 }))).toBe(-30);
    expect(differenceOf(record({ status: 'ABSENT', firstIn: null, workedMinutes: 0 }))).toBe(-480);
    // Worked on a day off: all of it is over.
    expect(differenceOf(record({ expectedMinutes: 0, workedMinutes: 240 }))).toBe(240);
  });

  it('has none while the day is open, nor on a day off nobody worked', () => {
    expect(differenceOf(record({ isFinal: false }))).toBeNull();
    expect(differenceOf(record({ expectedMinutes: 0, workedMinutes: 0 }))).toBeNull();
  });
});
