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

export interface TimecardTotals {
  /** Days with at least one entry. */
  daysWorked: number;
  workedMinutes: number;
  lateDays: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
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
    lateDays: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    overtimeMinutes: 0,
    absences: 0,
    incomplete: 0,
    strayDays: 0,
  };
  for (const r of records) {
    if (r.firstIn) totals.daysWorked++;
    totals.workedMinutes += r.workedMinutes;
    if (r.lateMinutes > 0) totals.lateDays++;
    totals.lateMinutes += r.lateMinutes;
    totals.earlyLeaveMinutes += r.earlyLeaveMinutes;
    totals.overtimeMinutes += r.overtimeMinutes;
    if (r.status === 'ABSENT') totals.absences++;
    if (r.status === 'INCOMPLETE') totals.incomplete++;
    if (r.anomalies.includes('STRAY_PUNCH')) totals.strayDays++;
  }
  return totals;
}
