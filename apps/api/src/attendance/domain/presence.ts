import type { PresenceState, PunchReading, PunchType } from '@asistcontrol/shared';
import {
  arrivalDeadline,
  calculateAttendance,
  expectedPresence,
  readPunches,
} from './attendance-calculator';
import type { CalculationInput, Punch, ResolvedShift } from './types';

const MINUTE_MS = 60_000;
/** Leaving this long before the scheduled lunch still counts as going to lunch. */
const EARLY_LUNCH_MS = 60 * MINUTE_MS;

export interface Presence {
  state: PresenceState;
  firstIn: Date | null;
  lateMinutes: number;
  /** The latest punch that counts: not a double press, not outside the day. */
  lastPunch: { id: string; at: Date; type: PunchType; reading: PunchReading } | null;
  /** When the person is expected, moved by approved leave. Null without fixed hours. */
  expectedStart: Date | null;
  expectedEnd: Date | null;
}

/**
 * Where a person is right now, from the punches of the work day `now` belongs to: inside,
 * at lunch, gone, not arrived (late or not yet), on leave or off. Pure: the caller passes
 * that work day and `now`; punches after `now` are ignored.
 */
export function presenceAt(input: CalculationInput): Presence {
  const { day, leaves, now } = input;
  const punches = input.punches.filter((p) => p.at <= now);
  const { firstIn, lateMinutes } = calculateAttendance({ ...input, punches });
  const readings = readPunches({ ...input, punches });

  let last: Punch | null = null;
  for (const p of punches) {
    const reading = readings.get(p.id);
    if (reading === 'DUPLICATE' || reading === 'OTHER_DAY') continue;
    if (!last || p.at > last.at) last = p;
  }
  const expected = day.shift ? expectedPresence(day.shift, leaves) : null;
  const presence = {
    firstIn,
    lateMinutes,
    lastPunch: last && {
      id: last.id,
      at: last.at,
      type: last.type,
      reading: readings.get(last.id)!,
    },
    expectedStart: expected?.expectedStart ?? null,
    expectedEnd: expected?.expectedEnd ?? null,
  };
  const state = stateOf(presence, input);
  return day.shift?.flexible
    ? { ...presence, state, expectedStart: null, expectedEnd: null }
    : { ...presence, state };
}

function stateOf(
  presence: Omit<Presence, 'state'>,
  { day, leaves, policy, now }: CalculationInput,
): PresenceState {
  const { lastPunch, expectedStart, expectedEnd } = presence;
  if (lastPunch) {
    const lunchKey = policy.punchPairing === 'DEVICE_TYPE' && lastPunch.type === 'BREAK_OUT';
    return stateAfter(lastPunch, lunchKey, day.shift, expectedEnd, now);
  }
  if (leaves.some((l) => l.start <= now && l.end > now)) return 'ON_LEAVE';
  if (day.dayType !== 'WORKDAY') return 'DAY_OFF';
  if (!day.shift || !expectedStart) return 'NO_SCHEDULE';
  return now > arrivalDeadline(day.shift, expectedStart) ? 'NOT_ARRIVED' : 'NOT_YET';
}

function stateAfter(
  last: { at: Date; reading: PunchReading },
  /** The lunch key was pressed and the company trusts the keys. */
  lunchKey: boolean,
  shift: ResolvedShift | null,
  expectedEnd: Date | null,
  now: Date,
): PresenceState {
  if (last.reading === 'CHECK_IN' || last.reading === 'BREAK_IN') return 'IN';
  // Once the working time is over, an exit is the day's exit whatever it was meant to be.
  if (!expectedEnd || now >= expectedEnd) return 'LEFT';
  if (lunchKey) return 'ON_BREAK';
  // Read in order, the exit to lunch is the day's last exit until the return is punched.
  const aroundLunch =
    shift?.breakStart &&
    shift.breakEnd &&
    last.at.getTime() >= shift.breakStart.getTime() - EARLY_LUNCH_MS &&
    last.at <= shift.breakEnd;
  return aroundLunch ? 'ON_BREAK' : 'LEFT';
}
