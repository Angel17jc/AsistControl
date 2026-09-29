/** Failed sends are retried after these waits, then given up (ADR 0011). */
const BACKOFF_MINUTES = [1, 5, 15, 60] as const;

export const MAX_EMAIL_ATTEMPTS = BACKOFF_MINUTES.length + 1;

/** A notification this old is no longer worth an email: the moment has passed. */
export const EMAIL_MAX_AGE_MS = 24 * 3_600_000;

/**
 * When to try again after the `attempts`-th failed send; null once every attempt is spent.
 * Deterministic on purpose (no jitter): a handful of emails per minute needs no smoothing,
 * and tests can state exact times.
 */
export function nextAttemptAfter(attempts: number, now: Date): Date | null {
  const wait = BACKOFF_MINUTES[attempts - 1];
  return wait === undefined ? null : new Date(now.getTime() + wait * 60_000);
}
