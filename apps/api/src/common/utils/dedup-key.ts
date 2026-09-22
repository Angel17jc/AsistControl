import { createHash } from 'node:crypto';

/**
 * Deterministic identity of a punch. Stored in a UNIQUE column, it makes ingestion idempotent:
 * re-downloading the same log from a device (or retrying a failed sync) can never duplicate it.
 * Timestamps are truncated to the second because that is the precision devices report.
 */
export function buildDedupKey(parts: {
  source: 'DEVICE' | 'MANUAL' | 'IMPORT';
  scope: string;
  subject: string;
  occurredAt: Date;
}): string {
  const second = Math.floor(parts.occurredAt.getTime() / 1000);
  return createHash('sha256')
    .update(`${parts.source}|${parts.scope}|${parts.subject}|${second}`)
    .digest('hex');
}
