import type { AttendanceEventCreatedPayload, DashboardSummary } from '@asistcontrol/shared';
import { describe, expect, it } from 'vitest';
import { withLatestEvent } from './realtime';

const summary = {
  date: '2026-11-04',
  timezone: 'America/Guayaquil',
  latestEvents: [],
} as unknown as DashboardSummary;
const event = (occurredAt: string) => ({ occurredAt }) as AttendanceEventCreatedPayload;

describe('withLatestEvent', () => {
  it("adds a punch of today, in the company's time", () => {
    // 23:30 in Guayaquil is already the next day in UTC.
    const late = event('2026-11-05T04:30:00.000Z');
    expect(withLatestEvent(summary, late).latestEvents).toEqual([late]);
  });

  it('leaves out a punch of another day', () => {
    const old = event('2026-10-05T14:00:00.000Z');
    expect(withLatestEvent(summary, old)).toBe(summary);
  });

  it('keeps the last fifteen', () => {
    let current = summary;
    for (let i = 0; i < 20; i++)
      current = withLatestEvent(current, event('2026-11-04T15:00:00.000Z'));
    expect(current.latestEvents).toHaveLength(15);
  });
});
