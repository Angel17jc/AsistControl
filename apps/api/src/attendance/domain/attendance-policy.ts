import { z } from 'zod';

/**
 * Company-wide labor rules. Stored in SystemSetting `attendance.policy` and editable at runtime.
 * Nothing here encodes a specific country's labor law — every value is a configurable default
 * (see docs/architecture.md § Reglas de negocio).
 */
export const attendancePolicySchema = z.object({
  /** Punches from the same person closer than this are treated as one (double press). */
  duplicatePunchWindowSeconds: z.number().int().min(0).max(600),
  /** Minutes after shift start before an arrival counts as late. Shifts may override. */
  lateToleranceMinutes: z.number().int().min(0).max(240),
  /** Minutes before shift end within which leaving is not flagged. Shifts may override. */
  earlyLeaveToleranceMinutes: z.number().int().min(0).max(240),
  /** Minimum extra minutes before overtime is recognized. Shifts may override. */
  overtimeThresholdMinutes: z.number().int().min(0).max(480),
  /**
   * AFTER_SHIFT_END: minutes worked after the scheduled end.
   * EXCESS_WORKED_TIME: total worked minus scheduled work (late arrivals are compensated first).
   */
  overtimeBasis: z.enum(['AFTER_SHIFT_END', 'EXCESS_WORKED_TIME']),
  /** Count minutes worked before the scheduled start as overtime (AFTER_SHIFT_END basis only). */
  countEarlyArrivalAsOvertime: z.boolean(),
  /**
   * SEQUENTIAL: punches alternate in/out regardless of the key pressed on the device (robust
   * against people pressing the wrong key). DEVICE_TYPE: trust the punch type reported.
   */
  punchPairing: z.enum(['SEQUENTIAL', 'DEVICE_TYPE']),
  /** When the shift has a break but nobody punched for it, deduct the scheduled break. */
  autoDeductUnpunchedBreak: z.boolean(),
  /** Breaks shorter than this are flagged (0 disables). */
  minBreakMinutes: z.number().int().min(0).max(240),
  /** Punches earlier than start - margin or later than end + margin are flagged. */
  outOfScheduleMarginMinutes: z.number().int().min(0).max(720),
  /** Window around the shift in which punches belong to that work day. */
  punchWindowBeforeShiftMinutes: z.number().int().min(0).max(720),
  punchWindowAfterShiftMinutes: z.number().int().min(0).max(720),
});

export type AttendancePolicy = z.infer<typeof attendancePolicySchema>;

export const DEFAULT_ATTENDANCE_POLICY: AttendancePolicy = Object.freeze({
  duplicatePunchWindowSeconds: 60,
  lateToleranceMinutes: 5,
  earlyLeaveToleranceMinutes: 0,
  overtimeThresholdMinutes: 15,
  overtimeBasis: 'AFTER_SHIFT_END',
  countEarlyArrivalAsOvertime: false,
  punchPairing: 'SEQUENTIAL',
  autoDeductUnpunchedBreak: true,
  minBreakMinutes: 0,
  outOfScheduleMarginMinutes: 180,
  punchWindowBeforeShiftMinutes: 240,
  punchWindowAfterShiftMinutes: 360,
});
