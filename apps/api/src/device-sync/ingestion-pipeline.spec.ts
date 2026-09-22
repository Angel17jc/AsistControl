import type { AttendanceLog } from '@asistcontrol/biometric-core';
import { runIngestionPipeline } from './ingestion-pipeline';

const NOW = new Date('2026-09-21T18:00:00.000Z');
const log = (overrides: Partial<AttendanceLog> = {}): AttendanceLog => ({
  deviceUserId: '1001',
  timestamp: new Date('2026-09-21T13:02:00.000Z'),
  punchType: 'CHECK_IN',
  verifyMode: 'FINGERPRINT',
  ...overrides,
});
const run = (logs: AttendanceLog[], deviceId = 'dev-1') =>
  runIngestionPipeline(logs, { deviceId, now: NOW });

describe('runIngestionPipeline', () => {
  it('accepts a valid log and computes a dedup key', () => {
    const { accepted, rejected } = run([log()]);
    expect(rejected).toEqual([]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.dedupKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it('drops exact duplicates inside the same batch', () => {
    const result = run([log(), log(), log()]);
    expect(result.accepted).toHaveLength(1);
    expect(result.duplicatesInBatch).toBe(2);
  });

  it('treats timestamps differing only in milliseconds as the same punch', () => {
    const result = run([log(), log({ timestamp: new Date('2026-09-21T13:02:00.450Z') })]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]!.occurredAt.getMilliseconds()).toBe(0);
  });

  it('keeps the same punch from two different devices apart', () => {
    const a = run([log()], 'dev-1').accepted[0]!.dedupKey;
    const b = run([log()], 'dev-2').accepted[0]!.dedupKey;
    expect(a).not.toBe(b);
  });

  it('produces the same key across batches (idempotent re-sync)', () => {
    expect(run([log()]).accepted[0]!.dedupKey).toBe(run([log()]).accepted[0]!.dedupKey);
  });

  it.each([
    ['MISSING_USER_ID', log({ deviceUserId: '  ' })],
    ['INVALID_USER_ID', log({ deviceUserId: '10;DROP TABLE' })],
    ['INVALID_TIMESTAMP', log({ timestamp: new Date('invalid') })],
    ['FUTURE_TIMESTAMP', log({ timestamp: new Date('2026-09-21T19:00:00.000Z') })],
    ['TOO_OLD', log({ timestamp: new Date('2000-01-01T00:00:00.000Z') })],
  ])('rejects %s', (reason, bad) => {
    const result = run([bad, log()]);
    expect(result.rejected).toEqual([expect.objectContaining({ reason })]);
    expect(result.accepted).toHaveLength(1);
  });

  it('tolerates small clock skew into the future', () => {
    expect(run([log({ timestamp: new Date(NOW.getTime() + 5 * 60_000) })]).accepted).toHaveLength(
      1,
    );
  });

  it('normalizes unknown punch types and verify modes instead of rejecting', () => {
    const [n] = run([log({ punchType: 'WEIRD' as never, verifyMode: 'IRIS' as never })]).accepted;
    expect(n!.punchType).toBe('UNKNOWN');
    expect(n!.verifyMode).toBe('OTHER');
  });

  it('trims user ids and returns logs in chronological order', () => {
    const { accepted } = run([
      log({ deviceUserId: ' 7 ', timestamp: new Date('2026-09-21T17:00:00Z') }),
      log({ deviceUserId: '7', timestamp: new Date('2026-09-21T13:00:00Z') }),
    ]);
    expect(accepted.map((a) => a.deviceUserId)).toEqual(['7', '7']);
    expect(accepted[0]!.occurredAt < accepted[1]!.occurredAt).toBe(true);
  });

  it('survives malformed entries without throwing', () => {
    const result = run([null as never, { deviceUserId: 5 } as never, log()]);
    expect(result.rejected).toHaveLength(2);
    expect(result.accepted).toHaveLength(1);
  });
});
