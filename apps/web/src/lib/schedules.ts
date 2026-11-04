import { formatMinutes } from './format';
import type { ScheduleAssignmentRow, WorkScheduleRow, WorkShiftRow } from './types';

const WEEKDAY = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'] as const;

/** ISO weekdays with their full names, Monday first. */
export const WEEKDAYS = [
  [1, 'Lunes'],
  [2, 'Martes'],
  [3, 'Miércoles'],
  [4, 'Jueves'],
  [5, 'Viernes'],
  [6, 'Sábado'],
  [7, 'Domingo'],
] as const;

/** "08:00–17:00", or "22:00–06:00 (+1 día)" for a shift that ends the next day. */
export function describeHours(startTime: string, endTime: string): string {
  return `${startTime}–${endTime}${endTime <= startTime ? ' (+1 día)' : ''}`;
}
const minutesOf = (hhmm: string) => {
  const [hours = 0, minutes = 0] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
};

type ShiftHours = Pick<WorkShiftRow, 'startTime' | 'endTime' | 'breakStart' | 'breakEnd'>;

/** How long the shift's day is expected to be: from start to end, without the lunch. */
export function expectedMinutes(shift: ShiftHours): number {
  const lunch =
    shift.breakStart && shift.breakEnd
      ? minutesOf(shift.breakEnd) - minutesOf(shift.breakStart)
      : 0;
  return minutesOf(shift.endTime) - minutesOf(shift.startTime) - lunch;
}

/** "08:00–17:00", or "Sin hora fija · 8h 00m al día". */
export function describeShift(shift: ShiftHours & Pick<WorkShiftRow, 'flexible'>): string {
  return shift.flexible
    ? `Sin hora fija · ${formatMinutes(expectedMinutes(shift))} al día`
    : describeHours(shift.startTime, shift.endTime);
}

const dayName = (weekday: number) => WEEKDAY[weekday - 1] ?? '?';

/**
 * A weekly schedule in one line, grouping consecutive days with the same hours:
 * "lun–vie 08:00–17:00 · sáb 08:00–12:00". Days not listed are rest days.
 */
export function describeWeek(days: WorkScheduleRow['days']): string {
  if (days.length === 0) return 'Sin días laborables';
  const groups: { from: number; to: number; hours: string }[] = [];
  for (const day of [...days].sort((a, b) => a.weekday - b.weekday)) {
    const hours = day.shift.flexible
      ? `sin hora fija (${formatMinutes(expectedMinutes(day.shift))} al día)`
      : `${day.shift.startTime}–${day.shift.endTime}`;
    const last = groups.at(-1);
    if (last && last.to === day.weekday - 1 && last.hours === hours) last.to = day.weekday;
    else groups.push({ from: day.weekday, to: day.weekday, hours });
  }
  return groups
    .map(({ from, to, hours }) => {
      if (from === to) return `${dayName(from)} ${hours}`;
      const sep = to === from + 1 ? ' y ' : '–';
      return `${dayName(from)}${sep}${dayName(to)} ${hours}`;
    })
    .join(' · ');
}

export type AssignmentState = 'past' | 'current' | 'scheduled';

export function assignmentState(a: ScheduleAssignmentRow, today: string): AssignmentState {
  if (a.effectiveFrom > today) return 'scheduled';
  if (a.effectiveTo !== null && a.effectiveTo < today) return 'past';
  return 'current';
}

/** Mirrors the API: the latest assignment can be undone while it started ≤ 62 days ago. */
export const UNDO_WINDOW_DAYS = 62;

export function canUndo(latest: ScheduleAssignmentRow, today: string): boolean {
  const started = Date.parse(latest.effectiveFrom);
  const now = Date.parse(today);
  return (now - started) / 86_400_000 <= UNDO_WINDOW_DAYS;
}
