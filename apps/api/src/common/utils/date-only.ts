import { DateTime } from 'luxon';

/**
 * Calendar dates (`@db.Date`) travel through Prisma as JS Dates at UTC midnight.
 * These helpers keep that convention in one place so no code does ad-hoc date math.
 */
export const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function toDbDate(isoDate: string): Date {
  if (!DATE_ONLY_REGEX.test(isoDate)) throw new Error(`Invalid date "${isoDate}"`);
  return new Date(`${isoDate}T00:00:00.000Z`);
}

export function fromDbDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Local calendar date of an instant in the given timezone. */
export function localDateOf(instant: Date, timezone: string): string {
  return DateTime.fromJSDate(instant, { zone: timezone }).toISODate()!;
}

export function addDays(isoDate: string, days: number): string {
  return DateTime.fromISO(isoDate, { zone: 'utc' }).plus({ days }).toISODate()!;
}

/** Inclusive list of dates between two ISO dates. */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function todayIn(timezone: string, now = new Date()): string {
  return localDateOf(now, timezone);
}

/** [start, end) instants of a local calendar day. */
export function localDayBounds(isoDate: string, timezone: string): { from: Date; to: Date } {
  const start = DateTime.fromISO(isoDate, { zone: timezone }).startOf('day');
  return { from: start.toJSDate(), to: start.plus({ days: 1 }).toJSDate() };
}
