/** Formats minutes as "7h 04m". Negative values are clamped to zero. */
export function formatMinutes(total: number): string {
  const safe = Math.max(0, Math.round(total));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

/** Formats a difference of minutes with its sign: "+1h 05m", "−0h 30m", "0h 00m". */
export function formatDifference(total: number): string {
  const rounded = Math.round(total);
  if (rounded === 0) return formatMinutes(0);
  return `${rounded > 0 ? '+' : '−'}${formatMinutes(Math.abs(rounded))}`;
}
