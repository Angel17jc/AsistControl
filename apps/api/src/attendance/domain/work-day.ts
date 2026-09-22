import type { DayType } from '@asistcontrol/shared';
import { DateTime } from 'luxon';
import type { AttendancePolicy } from './attendance-policy';
import type { ResolvedShift, WorkDayContext } from './types';

/** Shift template as stored in the database (local wall-clock times). */
export interface ShiftTemplate {
  id: string;
  startTime: string;
  endTime: string;
  breakStart: string | null;
  breakEnd: string | null;
  lateToleranceMinutes: number | null;
  earlyLeaveToleranceMinutes: number | null;
  overtimeThresholdMinutes: number | null;
}

export const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export function crossesMidnight(startTime: string, endTime: string): boolean {
  return endTime <= startTime;
}

/**
 * Anchors a shift template on a local date. Times earlier than the start belong to the next
 * calendar day, which is how night shifts (22:00 → 06:00) are represented. Using the IANA
 * timezone keeps DST transitions correct for companies in zones that observe it.
 */
export function resolveShift(
  template: ShiftTemplate,
  workDate: string,
  timezone: string,
  policy: AttendancePolicy,
): ResolvedShift {
  const at = (hhmm: string) => {
    const [hour, minute] = hhmm.split(':').map(Number) as [number, number];
    let dt = DateTime.fromISO(workDate, { zone: timezone }).set({
      hour,
      minute,
      second: 0,
      millisecond: 0,
    });
    if (hhmm < template.startTime) dt = dt.plus({ days: 1 });
    return dt.toJSDate();
  };
  const start = at(template.startTime);
  let end = at(template.endTime);
  if (end.getTime() === start.getTime()) end = new Date(start.getTime() + 24 * 3_600_000);

  return {
    shiftId: template.id,
    start,
    end,
    breakStart: template.breakStart ? at(template.breakStart) : null,
    breakEnd: template.breakEnd ? at(template.breakEnd) : null,
    lateToleranceMinutes: template.lateToleranceMinutes ?? policy.lateToleranceMinutes,
    earlyLeaveToleranceMinutes:
      template.earlyLeaveToleranceMinutes ?? policy.earlyLeaveToleranceMinutes,
    overtimeThresholdMinutes: template.overtimeThresholdMinutes ?? policy.overtimeThresholdMinutes,
  };
}

/**
 * Builds the evaluation context of a work day: which shift applies and which punches belong
 * to it. Days without a shift use the local calendar day as window.
 */
export function buildWorkDay(params: {
  workDate: string;
  timezone: string;
  policy: AttendancePolicy;
  template: ShiftTemplate | null;
  isHoliday: boolean;
  hasSchedule: boolean;
}): WorkDayContext {
  const { workDate, timezone, policy, template, isHoliday, hasSchedule } = params;
  const shift = template ? resolveShift(template, workDate, timezone, policy) : null;

  let dayType: DayType = 'WORKDAY';
  if (isHoliday) dayType = 'HOLIDAY';
  else if (hasSchedule && !template) dayType = 'REST_DAY';

  const window = shift
    ? {
        from: new Date(shift.start.getTime() - policy.punchWindowBeforeShiftMinutes * 60_000),
        to: new Date(shift.end.getTime() + policy.punchWindowAfterShiftMinutes * 60_000),
      }
    : calendarDay(workDate, timezone);

  return { workDate, dayType, shift: dayType === 'HOLIDAY' ? null : shift, hasSchedule, window };
}

export function calendarDay(workDate: string, timezone: string): { from: Date; to: Date } {
  const start = DateTime.fromISO(workDate, { zone: timezone }).startOf('day');
  return { from: start.toJSDate(), to: start.plus({ days: 1 }).toJSDate() };
}

/**
 * A punch at 02:00 may belong to yesterday's night shift. Given the contexts of the previous
 * and current local day, returns the work date the punch belongs to.
 */
export function assignWorkDate(
  punchAt: Date,
  previousDay: WorkDayContext,
  currentDay: WorkDayContext,
): string {
  const inPrevious =
    previousDay.shift !== null &&
    punchAt >= previousDay.window.from &&
    punchAt < previousDay.window.to;
  return inPrevious ? previousDay.workDate : currentDay.workDate;
}
