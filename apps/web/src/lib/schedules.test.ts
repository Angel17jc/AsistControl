import { describe, expect, it } from 'vitest';
import {
  assignmentState,
  canUndo,
  describeShift,
  describeWeek,
  expectedMinutes,
} from './schedules';
import type { ScheduleAssignmentRow } from './types';

const shift = (startTime: string, endTime: string) => ({
  name: 's',
  startTime,
  endTime,
  breakStart: null,
  breakEnd: null,
  flexible: false,
});
const office = shift('08:00', '17:00');

const assignment = (effectiveFrom: string, effectiveTo: string | null): ScheduleAssignmentRow => ({
  id: 'a',
  effectiveFrom,
  effectiveTo,
  schedule: { id: 's', name: 'Oficina' },
});

describe('shifts without fixed hours', () => {
  const flexible = {
    ...shift('08:00', '17:00'),
    breakStart: '13:00',
    breakEnd: '14:00',
    flexible: true,
  };

  it('expects the reference day without its lunch', () => {
    expect(expectedMinutes(flexible)).toBe(8 * 60);
    expect(expectedMinutes({ ...flexible, breakStart: null, breakEnd: null })).toBe(9 * 60);
  });

  it('are described by their hours a day, not by a schedule', () => {
    expect(describeShift(flexible)).toBe('Sin hora fija · 8h 00m al día');
    expect(describeShift({ ...flexible, flexible: false })).toBe('08:00–17:00');
    const week = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, shift: flexible }));
    expect(describeWeek(week)).toBe('lun–vie sin hora fija (8h 00m al día)');
  });
});

describe('describeWeek', () => {
  it('groups consecutive days with the same hours', () => {
    const days = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, shift: office }));
    days.push({ weekday: 6, shift: shift('08:00', '12:00') });
    expect(describeWeek(days)).toBe('lun–vie 08:00–17:00 · sáb 08:00–12:00');
  });

  it('keeps apart days separated by a rest day, whatever their order', () => {
    const days = [5, 1, 3].map((weekday) => ({ weekday, shift: office }));
    expect(describeWeek(days)).toBe('lun 08:00–17:00 · mié 08:00–17:00 · vie 08:00–17:00');
  });

  it('joins two days with "y" and shows night shifts as they are', () => {
    const night = shift('22:00', '06:00');
    expect(describeWeek([6, 7].map((weekday) => ({ weekday, shift: night })))).toBe(
      'sáb y dom 22:00–06:00',
    );
  });

  it('says so when nobody works', () => {
    expect(describeWeek([])).toBe('Sin días laborables');
  });
});

describe('assignmentState', () => {
  const today = '2026-09-24';

  it('tells past, current and scheduled periods apart', () => {
    expect(assignmentState(assignment('2026-01-01', '2026-08-31'), today)).toBe('past');
    expect(assignmentState(assignment('2026-09-01', null), today)).toBe('current');
    expect(assignmentState(assignment('2026-01-01', '2026-09-24'), today)).toBe('current');
    expect(assignmentState(assignment('2026-10-01', null), today)).toBe('scheduled');
  });
});

describe('canUndo', () => {
  it('follows the 62-day window of the API', () => {
    expect(canUndo(assignment('2026-12-01', null), '2026-09-24')).toBe(true);
    expect(canUndo(assignment('2026-07-24', null), '2026-09-24')).toBe(true);
    expect(canUndo(assignment('2026-07-23', null), '2026-09-24')).toBe(false);
  });
});
