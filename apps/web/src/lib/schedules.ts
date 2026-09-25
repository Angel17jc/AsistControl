import type { ScheduleAssignmentRow, WorkScheduleRow } from './types';

const WEEKDAY = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'] as const;
const dayName = (weekday: number) => WEEKDAY[weekday - 1] ?? '?';

/**
 * A weekly schedule in one line, grouping consecutive days with the same hours:
 * "lun–vie 08:00–17:00 · sáb 08:00–12:00". Days not listed are rest days.
 */
export function describeWeek(days: WorkScheduleRow['days']): string {
  if (days.length === 0) return 'Sin días laborables';
  const groups: { from: number; to: number; hours: string }[] = [];
  for (const day of [...days].sort((a, b) => a.weekday - b.weekday)) {
    const hours = `${day.shift.startTime}–${day.shift.endTime}`;
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
