import { describe, expect, it } from 'vitest';
import { breaksOf, timecardTotals } from './timecard';
import type { AttendanceRecordRow } from './types';

const record = (rest: Partial<AttendanceRecordRow>): AttendanceRecordRow =>
  ({
    status: 'PRESENT',
    firstIn: '2026-10-01T13:00:00.000Z',
    workedMinutes: 480,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    overtimeMinutes: 0,
    anomalies: [],
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
      record({ status: 'REST_DAY', firstIn: null, workedMinutes: 0 }),
    ]);
    expect(totals).toEqual({
      daysWorked: 3,
      workedMinutes: 1038,
      lateDays: 1,
      lateMinutes: 12,
      earlyLeaveMinutes: 30,
      overtimeMinutes: 90,
      absences: 1,
      incomplete: 1,
      strayDays: 1,
    });
  });
});
