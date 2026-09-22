import { describe, expect, it } from 'vitest';
import { formatMinutes, formatTime, relativeTime } from './format';

describe('format helpers', () => {
  it('formats worked minutes', () => {
    expect(formatMinutes(484)).toBe('8h 04m');
  });

  it('shows times in the company timezone regardless of the browser zone', () => {
    // 13:02 UTC = 08:02 in America/Guayaquil (UTC-5)
    expect(formatTime('2026-09-21T13:02:00.000Z')).toBe('08:02');
    expect(formatTime(null)).toBe('—');
  });

  it('describes relative times', () => {
    const now = Date.parse('2026-09-21T12:00:00Z');
    expect(relativeTime('2026-09-21T11:59:30Z', now)).toBe('hace instantes');
    expect(relativeTime('2026-09-21T11:45:00Z', now)).toBe('hace 15 min');
    expect(relativeTime('2026-09-21T09:00:00Z', now)).toBe('hace 3 h');
    expect(relativeTime(null, now)).toBe('nunca');
  });
});
