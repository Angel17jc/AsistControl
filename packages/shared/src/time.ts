/** Formats minutes as "7h 04m". Negative values are clamped to zero. */
export function formatMinutes(total: number): string {
  const safe = Math.max(0, Math.round(total));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}
