import type { DeviceLocalTime } from './protocol';

/** Offset of a timezone at a given instant, in minutes (positive east of UTC). */
export function timezoneOffsetMinutes(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return (asUtc - instant) / 60_000;
}

/**
 * Terminals report wall-clock time with no timezone, so the same reading means different
 * instants depending on where the device is installed. The second pass handles DST changes,
 * where the offset at the guessed instant differs from the offset at the real one.
 */
export function localTimeToInstant(local: DeviceLocalTime, timeZone: string): Date {
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  const firstOffset = timezoneOffsetMinutes(asUtc, timeZone);
  const guess = asUtc - firstOffset * 60_000;
  const secondOffset = timezoneOffsetMinutes(guess, timeZone);
  return new Date(secondOffset === firstOffset ? guess : asUtc - secondOffset * 60_000);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}
