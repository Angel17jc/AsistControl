import type { PunchType } from '@asistcontrol/shared';
import { DateTime } from 'luxon';
import { type AttendancePolicy, DEFAULT_ATTENDANCE_POLICY } from './attendance-policy';
import { presenceAt } from './presence';
import type { LeaveInterval, Punch } from './types';
import { type ShiftTemplate, buildWorkDay } from './work-day';

const TZ = 'America/Guayaquil';
const DATE = '2026-09-21';
const NEXT = '2026-09-22';

const OFFICE: ShiftTemplate = {
  id: 'office',
  startTime: '08:00',
  endTime: '17:00',
  breakStart: '12:00',
  breakEnd: '13:00',
  lateToleranceMinutes: null,
  earlyLeaveToleranceMinutes: null,
  overtimeThresholdMinutes: null,
};
const NIGHT: ShiftTemplate = {
  ...OFFICE,
  id: 'night',
  startTime: '22:00',
  endTime: '06:00',
  breakStart: null,
  breakEnd: null,
};

const t = (hhmm: string, date = DATE) =>
  DateTime.fromISO(`${date}T${hhmm}`, { zone: TZ }).toJSDate();

let seq = 0;
const punch = (hhmm: string, type: PunchType = 'UNKNOWN', date = DATE): Punch => ({
  id: `p${++seq}`,
  at: t(hhmm, date),
  type,
});

function at(
  now: Date,
  punches: Punch[] = [],
  options: {
    template?: ShiftTemplate | null;
    leaves?: LeaveInterval[];
    policy?: Partial<AttendancePolicy>;
    isHoliday?: boolean;
    hasSchedule?: boolean;
  } = {},
) {
  const policy = { ...DEFAULT_ATTENDANCE_POLICY, ...options.policy };
  const day = buildWorkDay({
    workDate: DATE,
    timezone: TZ,
    policy,
    template: options.template === undefined ? OFFICE : options.template,
    isHoliday: options.isHoliday ?? false,
    hasSchedule: options.hasSchedule ?? true,
  });
  return presenceAt({ day, punches, leaves: options.leaves ?? [], policy, now });
}

describe('presenceAt', () => {
  it('waits for someone until the tolerance has passed', () => {
    expect(at(t('07:30')).state).toBe('NOT_YET');
    expect(at(t('08:05')).state).toBe('NOT_YET');
    expect(at(t('08:06'))).toMatchObject({ state: 'NOT_ARRIVED', expectedStart: t('08:00') });
  });

  it('shows who is in, since when and how late', () => {
    expect(at(t('09:00'), [punch('08:03')])).toMatchObject({
      state: 'IN',
      firstIn: t('08:03'),
      lateMinutes: 0,
    });
    expect(at(t('09:00'), [punch('08:20')])).toMatchObject({ state: 'IN', lateMinutes: 20 });
  });

  it('follows a day with lunch: in, at lunch, back, gone', () => {
    const day = [punch('08:00'), punch('12:02'), punch('13:00'), punch('17:01')];
    expect(at(t('12:30'), day)).toMatchObject({
      state: 'ON_BREAK',
      lastPunch: { at: t('12:02'), reading: 'CHECK_OUT' },
    });
    expect(at(t('13:30'), day).state).toBe('IN');
    expect(at(t('17:30'), day).state).toBe('LEFT');
  });

  it('ignores the punches that have not happened yet', () => {
    expect(at(t('10:00'), [punch('08:00'), punch('17:00')]).state).toBe('IN');
  });

  it('tells an early exit apart from lunch', () => {
    expect(at(t('15:30'), [punch('08:00'), punch('15:00')]).state).toBe('LEFT');
    expect(at(t('11:30'), [punch('08:00'), punch('11:10')]).state).toBe('ON_BREAK');
  });

  it('counts a lunch exit without return as gone once the working time is over', () => {
    expect(at(t('18:00'), [punch('08:00'), punch('12:02')]).state).toBe('LEFT');
  });

  it('trusts the lunch key when punches are paired by the key pressed', () => {
    const day = [punch('08:00', 'CHECK_IN'), punch('15:00', 'BREAK_OUT')];
    expect(at(t('15:10'), day, { policy: { punchPairing: 'DEVICE_TYPE' } }).state).toBe('ON_BREAK');
  });

  it('does not take a double press for an exit', () => {
    const first = punch('08:00');
    const again: Punch = {
      id: 'again',
      at: new Date(first.at.getTime() + 20_000),
      type: 'UNKNOWN',
    };
    expect(at(t('09:00'), [first, again]).state).toBe('IN');
  });

  it('shows approved leave, and waits after a morning permission ends', () => {
    const allDay = { id: 'l1', start: t('00:00'), end: t('23:59') };
    expect(at(t('09:00'), [], { leaves: [allDay] }).state).toBe('ON_LEAVE');

    const morning = { id: 'l2', start: t('08:00'), end: t('10:00') };
    expect(at(t('10:03'), [], { leaves: [morning] }).state).toBe('NOT_YET');
    expect(at(t('10:30'), [], { leaves: [morning] })).toMatchObject({
      state: 'NOT_ARRIVED',
      expectedStart: t('10:00'),
    });
  });

  it('separates days off from people without a schedule', () => {
    expect(at(t('09:00'), [], { template: null }).state).toBe('DAY_OFF');
    expect(at(t('09:00'), [], { isHoliday: true }).state).toBe('DAY_OFF');
    expect(at(t('09:00'), [], { template: null, hasSchedule: false }).state).toBe('NO_SCHEDULE');
    expect(at(t('09:00'), [punch('08:00')], { template: null }).state).toBe('IN');
  });

  it('keeps a night shift in after midnight', () => {
    expect(at(t('02:00', NEXT), [punch('22:01')], { template: NIGHT }).state).toBe('IN');
    expect(
      at(t('06:30', NEXT), [punch('22:01'), punch('06:02', 'UNKNOWN', NEXT)], { template: NIGHT })
        .state,
    ).toBe('LEFT');
  });
});
