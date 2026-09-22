import type {
  AttendanceAnomaly,
  AttendanceStatus,
  DayType,
  OvertimeKind,
  PunchType,
} from '@asistcontrol/shared';
import type { AttendancePolicy } from './attendance-policy';

/** A shift materialized on a concrete date: absolute instants, tolerances already resolved. */
export interface ResolvedShift {
  shiftId: string;
  start: Date;
  end: Date;
  breakStart: Date | null;
  breakEnd: Date | null;
  lateToleranceMinutes: number;
  earlyLeaveToleranceMinutes: number;
  overtimeThresholdMinutes: number;
}

export interface Punch {
  id: string;
  at: Date;
  type: PunchType;
}

export interface LeaveInterval {
  id: string;
  start: Date;
  end: Date;
}

export interface WorkDayContext {
  workDate: string;
  dayType: DayType;
  /** Null on rest days/holidays without a shift, or when the employee has no schedule. */
  shift: ResolvedShift | null;
  hasSchedule: boolean;
  /** Instants delimiting which punches belong to this work day. */
  window: { from: Date; to: Date };
}

export interface CalculationInput {
  day: WorkDayContext;
  punches: Punch[];
  leaves: LeaveInterval[];
  policy: AttendancePolicy;
  now: Date;
}

export interface WorkSegment {
  in: Date | null;
  out: Date | null;
}

export interface CalculationResult {
  status: AttendanceStatus;
  anomalies: AttendanceAnomaly[];
  segments: WorkSegment[];
  firstIn: Date | null;
  lastOut: Date | null;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  overtimeKind: OvertimeKind | null;
  /** Punches ignored as double presses. */
  ignoredPunchIds: string[];
  /** False while the work day window is still open: results may still change. */
  isFinal: boolean;
}
