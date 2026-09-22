import type { AttendanceAnomaly, AttendanceStatus, PunchType } from '@asistcontrol/shared';
import type { AttendancePolicy } from './attendance-policy';
import type {
  CalculationInput,
  CalculationResult,
  LeaveInterval,
  Punch,
  ResolvedShift,
  WorkSegment,
} from './types';

const MINUTE_MS = 60_000;

/**
 * Turns the raw punches of one employee on one work day into an attendance summary.
 *
 * Pure function: no I/O, no clock access (the caller passes `now`), no framework.
 * Every rule is driven by the policy and the resolved shift, so it can be unit-tested
 * exhaustively and re-run at any time to rebuild AttendanceRecords from AttendanceEvents.
 */
export function calculateAttendance(input: CalculationInput): CalculationResult {
  const { day, policy, now } = input;
  const shift = day.shift;
  const isFinal = now.getTime() >= day.window.to.getTime();
  const anomalies = new Set<AttendanceAnomaly>();

  const inWindow = input.punches
    .filter((p) => p.at >= day.window.from && p.at < day.window.to)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const { kept, ignored } = dropDoublePresses(inWindow, policy.duplicatePunchWindowSeconds);
  if (ignored.length > 0) anomalies.add('DUPLICATE_PUNCH');

  if (kept.length === 0) {
    return {
      ...emptyResult(isFinal),
      anomalies: [...anomalies],
      ignoredPunchIds: ignored.map((p) => p.id),
      status: statusWithoutPunches(input),
    };
  }

  const segments =
    policy.punchPairing === 'SEQUENTIAL' ? pairSequentially(kept) : pairByPunchType(kept);
  const complete = segments.filter(isComplete);

  segments.forEach((s, i) => {
    if (s.in === null) anomalies.add('MISSING_CHECK_IN');
    const ongoing = i === segments.length - 1 && !isFinal;
    if (s.out === null && !ongoing) anomalies.add('MISSING_CHECK_OUT');
  });

  let workedMs = complete.reduce((sum, s) => sum + (s.out.getTime() - s.in.getTime()), 0);
  let breakMs = gapsBetween(segments);

  if (shift?.breakStart && shift.breakEnd && policy.autoDeductUnpunchedBreak) {
    const { breakStart, breakEnd } = shift;
    const workedThroughBreak = complete.some((s) => s.in <= breakStart && s.out >= breakEnd);
    if (workedThroughBreak) {
      const scheduledBreak = breakEnd.getTime() - breakStart.getTime();
      workedMs -= scheduledBreak;
      breakMs += scheduledBreak;
    }
  }

  const workedMinutes = Math.max(0, Math.floor(workedMs / MINUTE_MS));
  const breakMinutes = Math.floor(breakMs / MINUTE_MS);
  if (shift?.breakStart && policy.minBreakMinutes > 0 && complete.length >= 2) {
    if (breakMinutes < policy.minBreakMinutes) anomalies.add('SHORT_BREAK');
  }

  const firstIn = segments.find((s) => s.in !== null)?.in ?? null;
  const lastOut = [...segments].reverse().find((s) => s.out !== null)?.out ?? null;

  const base = {
    segments,
    firstIn,
    lastOut,
    workedMinutes,
    breakMinutes,
    ignoredPunchIds: ignored.map((p) => p.id),
    isFinal,
  };

  // Worked on a day without a shift: rest day, holiday or employee without schedule.
  if (!shift || day.dayType !== 'WORKDAY') {
    const kind = day.dayType === 'HOLIDAY' ? 'HOLIDAY' : 'REST_DAY';
    if (day.dayType === 'HOLIDAY') anomalies.add('WORKED_ON_HOLIDAY');
    if (day.dayType === 'REST_DAY') anomalies.add('WORKED_ON_REST_DAY');

    const isUnscheduledWorkday = day.dayType === 'WORKDAY';
    const overtime =
      !isUnscheduledWorkday && workedMinutes >= policy.overtimeThresholdMinutes ? workedMinutes : 0;
    if (overtime > 0) anomalies.add('OVERTIME');

    return {
      ...base,
      status: isUnscheduledWorkday ? 'NO_SCHEDULE' : kind,
      anomalies: [...anomalies],
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      overtimeMinutes: overtime,
      overtimeKind: overtime > 0 ? kind : null,
    };
  }

  const { expectedStart, expectedEnd } = expectedPresence(shift, input.leaves);

  // Lateness can only be measured if the first segment has a real entry.
  let lateMinutes = 0;
  const firstSegment = segments[0]!;
  if (firstSegment.in) {
    const lateBy = minutesBetween(expectedStart, firstSegment.in);
    if (lateBy > shift.lateToleranceMinutes) {
      lateMinutes = lateBy;
      anomalies.add('LATE_ARRIVAL');
    }
  }

  // Early leave is only judged once the scheduled end has passed; before that the
  // employee may simply be at lunch.
  let earlyLeaveMinutes = 0;
  const lastSegment = segments.at(-1)!;
  if (lastSegment.out && now >= expectedEnd) {
    const earlyBy = minutesBetween(lastSegment.out, expectedEnd);
    if (earlyBy > shift.earlyLeaveToleranceMinutes) {
      earlyLeaveMinutes = earlyBy;
      anomalies.add('EARLY_LEAVE');
    }
  }

  const overtimeMinutes = computeOvertime(policy, shift, complete, workedMinutes);
  if (overtimeMinutes > 0) anomalies.add('OVERTIME');

  const marginMs = policy.outOfScheduleMarginMinutes * MINUTE_MS;
  const outOfSchedule = kept.some(
    (p) =>
      p.at.getTime() < shift.start.getTime() - marginMs ||
      p.at.getTime() > shift.end.getTime() + marginMs,
  );
  if (outOfSchedule) anomalies.add('OUT_OF_SCHEDULE_PUNCH');

  let status: AttendanceStatus = 'PRESENT';
  if (anomalies.has('MISSING_CHECK_IN') || anomalies.has('MISSING_CHECK_OUT'))
    status = 'INCOMPLETE';
  else if (lateMinutes > 0) status = 'LATE';

  return {
    ...base,
    status,
    anomalies: [...anomalies],
    lateMinutes,
    earlyLeaveMinutes,
    overtimeMinutes,
    overtimeKind: overtimeMinutes > 0 ? 'REGULAR' : null,
  };
}

// ───────────────────────────────────────────────────────────── steps

/** Collapses punches closer than `windowSeconds` to the previous kept punch. */
export function dropDoublePresses(
  ordered: Punch[],
  windowSeconds: number,
): { kept: Punch[]; ignored: Punch[] } {
  const kept: Punch[] = [];
  const ignored: Punch[] = [];
  for (const punch of ordered) {
    const previous = kept.at(-1);
    if (previous && punch.at.getTime() - previous.at.getTime() < windowSeconds * 1000) {
      ignored.push(punch);
    } else {
      kept.push(punch);
    }
  }
  return { kept, ignored };
}

/** in, out, in, out… regardless of the key pressed on the terminal. */
export function pairSequentially(punches: Punch[]): WorkSegment[] {
  const segments: WorkSegment[] = [];
  for (let i = 0; i < punches.length; i += 2) {
    segments.push({ in: punches[i]!.at, out: punches[i + 1]?.at ?? null });
  }
  return segments;
}

/** Uses the punch type reported by the device; UNKNOWN is inferred from the current state. */
export function pairByPunchType(punches: Punch[]): WorkSegment[] {
  const segments: WorkSegment[] = [];
  let open: Date | null = null;
  for (const punch of punches) {
    const direction = directionOf(punch.type) ?? (open ? 'OUT' : 'IN');
    if (direction === 'IN') {
      if (open) segments.push({ in: open, out: null });
      open = punch.at;
    } else {
      segments.push({ in: open, out: punch.at });
      open = null;
    }
  }
  if (open) segments.push({ in: open, out: null });
  return segments;
}

function directionOf(type: PunchType): 'IN' | 'OUT' | null {
  if (type === 'CHECK_IN' || type === 'BREAK_IN') return 'IN';
  if (type === 'CHECK_OUT' || type === 'BREAK_OUT') return 'OUT';
  return null;
}

/**
 * Approved leave shifts the expected presence: a morning permission moves the expected
 * arrival to the end of the permission, an afternoon one moves the expected departure.
 */
export function expectedPresence(
  shift: ResolvedShift,
  leaves: LeaveInterval[],
): { expectedStart: Date; expectedEnd: Date } {
  let expectedStart = shift.start;
  let expectedEnd = shift.end;
  for (const leave of leaves) {
    if (leave.start <= shift.start && leave.end > shift.start) {
      expectedStart = new Date(Math.min(leave.end.getTime(), shift.end.getTime()));
    }
    if (leave.start < shift.end && leave.end >= shift.end) {
      expectedEnd = new Date(Math.max(leave.start.getTime(), shift.start.getTime()));
    }
  }
  return { expectedStart, expectedEnd };
}

function computeOvertime(
  policy: AttendancePolicy,
  shift: ResolvedShift,
  complete: CompleteSegment[],
  workedMinutes: number,
): number {
  let extra: number;
  if (policy.overtimeBasis === 'EXCESS_WORKED_TIME') {
    extra = workedMinutes - scheduledWorkMinutes(shift);
  } else {
    extra = Math.floor(overlapMs(complete, shift.end, null) / MINUTE_MS);
    if (policy.countEarlyArrivalAsOvertime) {
      extra += Math.floor(overlapMs(complete, null, shift.start) / MINUTE_MS);
    }
  }
  return extra >= Math.max(1, shift.overtimeThresholdMinutes) ? extra : 0;
}

export function scheduledWorkMinutes(shift: ResolvedShift): number {
  const total = shift.end.getTime() - shift.start.getTime();
  const pause =
    shift.breakStart && shift.breakEnd ? shift.breakEnd.getTime() - shift.breakStart.getTime() : 0;
  return Math.floor((total - pause) / MINUTE_MS);
}

function statusWithoutPunches({ day, leaves }: CalculationInput): AttendanceStatus {
  if (day.dayType === 'HOLIDAY') return 'HOLIDAY';
  if (day.dayType === 'REST_DAY') return 'REST_DAY';
  if (!day.shift) return 'NO_SCHEDULE';
  const { start, end } = day.shift;
  const fullyCovered = leaves.some((l) => l.start <= start && l.end >= end);
  return fullyCovered ? 'ON_LEAVE' : 'ABSENT';
}

function emptyResult(isFinal: boolean): Omit<CalculationResult, 'status'> {
  return {
    anomalies: [],
    segments: [],
    firstIn: null,
    lastOut: null,
    workedMinutes: 0,
    breakMinutes: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    overtimeMinutes: 0,
    overtimeKind: null,
    ignoredPunchIds: [],
    isFinal,
  };
}

// ───────────────────────────────────────────────────────────── helpers

type CompleteSegment = { in: Date; out: Date };

function isComplete(s: WorkSegment): s is CompleteSegment {
  return s.in !== null && s.out !== null;
}

function minutesBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MINUTE_MS);
}

function gapsBetween(segments: WorkSegment[]): number {
  let total = 0;
  for (let i = 1; i < segments.length; i++) {
    const prevOut = segments[i - 1]!.out;
    const nextIn = segments[i]!.in;
    if (prevOut && nextIn) total += Math.max(0, nextIn.getTime() - prevOut.getTime());
  }
  return total;
}

/** Milliseconds of the segments that fall inside [from, to); null = unbounded. */
function overlapMs(segments: CompleteSegment[], from: Date | null, to: Date | null): number {
  return segments.reduce((sum, s) => {
    const start = Math.max(s.in.getTime(), from?.getTime() ?? -Infinity);
    const end = Math.min(s.out.getTime(), to?.getTime() ?? Infinity);
    return sum + Math.max(0, end - start);
  }, 0);
}
