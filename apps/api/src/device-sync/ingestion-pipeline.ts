import type { AttendanceLog } from '@asistcontrol/biometric-core';
import { PUNCH_TYPES, type PunchType, VERIFY_MODES, type VerifyMode } from '@asistcontrol/shared';
import { buildDedupKey } from '../common/utils/dedup-key';

export interface NormalizedLog {
  deviceUserId: string;
  occurredAt: Date;
  punchType: PunchType;
  verifyMode: VerifyMode;
  dedupKey: string;
  raw: Record<string, unknown> | null;
}

export type RejectionReason =
  'MISSING_USER_ID' | 'INVALID_USER_ID' | 'INVALID_TIMESTAMP' | 'FUTURE_TIMESTAMP' | 'TOO_OLD';

export interface Rejection {
  reason: RejectionReason;
  deviceUserId: unknown;
  timestamp: unknown;
}

export interface PipelineOptions {
  deviceId: string;
  now: Date;
  /** Device clocks drift; tolerate small skews into the future. */
  maxFutureSkewMs?: number;
  /** Logs older than this are considered corrupt (e.g. a device reset to 2000-01-01). */
  maxAgeDays?: number;
}

export interface PipelineResult {
  accepted: NormalizedLog[];
  rejected: Rejection[];
  /** Identical logs repeated inside the same batch (faulty firmware, overlapping reads). */
  duplicatesInBatch: number;
}

const USER_ID_PATTERN = /^[A-Za-z0-9]{1,24}$/;
const DEFAULT_FUTURE_SKEW_MS = 10 * 60_000;
const DEFAULT_MAX_AGE_DAYS = 400;

/**
 * Pure ingestion stages applied to every batch coming from any adapter:
 *   validate → normalize → deduplicate (within batch)
 * Cross-batch deduplication happens in the database through the unique dedup key.
 */
export function runIngestionPipeline(
  logs: AttendanceLog[],
  options: PipelineOptions,
): PipelineResult {
  const maxFuture = options.now.getTime() + (options.maxFutureSkewMs ?? DEFAULT_FUTURE_SKEW_MS);
  const minPast = options.now.getTime() - (options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS) * 86_400_000;

  const rejected: Rejection[] = [];
  const byKey = new Map<string, NormalizedLog>();
  let duplicatesInBatch = 0;

  for (const log of logs) {
    const reason = validate(log, maxFuture, minPast);
    if (reason) {
      rejected.push({ reason, deviceUserId: log?.deviceUserId, timestamp: log?.timestamp });
      continue;
    }
    const normalized = normalize(log, options.deviceId);
    if (byKey.has(normalized.dedupKey)) {
      duplicatesInBatch++;
      continue;
    }
    byKey.set(normalized.dedupKey, normalized);
  }

  const accepted = [...byKey.values()].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
  return { accepted, rejected, duplicatesInBatch };
}

function validate(log: AttendanceLog, maxFuture: number, minPast: number): RejectionReason | null {
  const userId = typeof log?.deviceUserId === 'string' ? log.deviceUserId.trim() : '';
  if (!userId) return 'MISSING_USER_ID';
  if (!USER_ID_PATTERN.test(userId)) return 'INVALID_USER_ID';

  const ts = log.timestamp instanceof Date ? log.timestamp.getTime() : Number.NaN;
  if (Number.isNaN(ts)) return 'INVALID_TIMESTAMP';
  if (ts > maxFuture) return 'FUTURE_TIMESTAMP';
  if (ts < minPast) return 'TOO_OLD';
  return null;
}

function normalize(log: AttendanceLog, deviceId: string): NormalizedLog {
  const deviceUserId = log.deviceUserId.trim();
  // Devices report second precision; drop sub-second noise so re-reads hash identically.
  const occurredAt = new Date(Math.floor(log.timestamp.getTime() / 1000) * 1000);
  return {
    deviceUserId,
    occurredAt,
    punchType: (PUNCH_TYPES as readonly string[]).includes(log.punchType)
      ? log.punchType
      : 'UNKNOWN',
    verifyMode: (VERIFY_MODES as readonly string[]).includes(log.verifyMode)
      ? log.verifyMode
      : 'OTHER',
    dedupKey: buildDedupKey({
      source: 'DEVICE',
      scope: deviceId,
      subject: deviceUserId,
      occurredAt,
    }),
    raw: log.raw ?? null,
  };
}
