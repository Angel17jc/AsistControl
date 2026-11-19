import type { AttendanceRecordRow } from './types';

/** The pauses between punched work segments: lunch, and any other exit and return. */
export function breaksOf(
  segments: AttendanceRecordRow['segments'],
): { out: string; back: string }[] {
  const breaks: { out: string; back: string }[] = [];
  for (let i = 1; i < segments.length; i++) {
    const out = segments[i - 1]!.out;
    const back = segments[i]!.in;
    if (out && back) breaks.push({ out, back });
  }
  return breaks;
}

/**
 * Worked minus expected on a closed day; null while the day is still open (its hours are not
 * all in yet) or on a day off nobody worked.
 */
export function differenceOf(r: AttendanceRecordRow): number | null {
  if (!r.isFinal) return null;
  if (r.expectedMinutes === 0 && r.workedMinutes === 0) return null;
  return r.workedMinutes - r.expectedMinutes;
}

export interface TimecardTotals {
  /** Days with at least one entry. */
  daysWorked: number;
  workedMinutes: number;
  /** What the schedule expected on the closed days, approved leave taken off. */
  expectedMinutes: number;
  /** Worked minus expected on the closed days. */
  differenceMinutes: number;
  /** Days still open: they are not in the expected hours nor in the difference yet. */
  openDays: number;
  lateDays: number;
  lateMinutes: number;
  longBreakDays: number;
  longBreakMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  shortMinutes: number;
  absences: number;
  /** Days missing an entry or an exit: they need a correction. */
  incomplete: number;
  /** Days with a punch no work day counted: someone should look at it. */
  strayDays: number;
}

/** What a time card adds up at the bottom: one employee, a period. */
export function timecardTotals(records: AttendanceRecordRow[]): TimecardTotals {
  const totals: TimecardTotals = {
    daysWorked: 0,
    workedMinutes: 0,
    expectedMinutes: 0,
    differenceMinutes: 0,
    openDays: 0,
    lateDays: 0,
    lateMinutes: 0,
    longBreakDays: 0,
    longBreakMinutes: 0,
    earlyLeaveMinutes: 0,
    overtimeMinutes: 0,
    shortMinutes: 0,
    absences: 0,
    incomplete: 0,
    strayDays: 0,
  };
  for (const r of records) {
    totals.daysWorked += Number(!!r.firstIn);
    totals.workedMinutes += r.workedMinutes;
    // An open day's hours are not all in yet: it enters the account when it closes.
    totals.openDays += Number(!r.isFinal);
    totals.expectedMinutes += r.isFinal ? r.expectedMinutes : 0;
    totals.differenceMinutes += r.isFinal ? r.workedMinutes - r.expectedMinutes : 0;
    totals.lateDays += Number(r.lateMinutes > 0);
    totals.lateMinutes += r.lateMinutes;
    totals.longBreakDays += Number(r.longBreakMinutes > 0);
    totals.longBreakMinutes += r.longBreakMinutes;
    totals.earlyLeaveMinutes += r.earlyLeaveMinutes;
    totals.overtimeMinutes += r.overtimeMinutes;
    totals.shortMinutes += r.shortMinutes;
    totals.absences += Number(r.status === 'ABSENT');
    totals.incomplete += Number(r.status === 'INCOMPLETE');
    totals.strayDays += Number(r.anomalies.includes('STRAY_PUNCH'));
  }
  return totals;
}
