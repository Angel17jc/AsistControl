import { createHash } from 'node:crypto';
import type { PunchType, VerifyMode } from '@asistcontrol/shared';
import type { BiometricDeviceAdapter } from '../adapter';
import { DeviceAuthenticationError, DeviceNotConnectedError, DeviceProtocolError } from '../errors';
import type {
  AdapterCapabilities,
  AttendanceLog,
  DeviceConnectionConfig,
  DeviceInfo,
  DeviceUser,
  SyncOptions,
  SyncResult,
} from '../types';
import { isValidTimeZone, localTimeToInstant } from './device-time';
import {
  ZK_COMMAND,
  type RawAttendanceRecord,
  decodeTime,
  makeCommKey,
  parseAttendanceRecords,
  parseOption,
  parseSizes,
  parseUsers,
} from './protocol';
import { ZkTcpClient } from './zkteco-client';

const DEFAULT_PORT = 4370;
const DEFAULT_TIMEOUT_MS = 10_000;

/** Key pressed on the terminal → platform punch type. Anything else stays UNKNOWN. */
const PUNCH_BY_CODE: Record<number, PunchType> = {
  0: 'CHECK_IN',
  1: 'CHECK_OUT',
  2: 'BREAK_OUT',
  3: 'BREAK_IN',
};

/** Verification method reported by the device. */
const VERIFY_BY_CODE: Record<number, VerifyMode> = {
  0: 'PASSWORD',
  1: 'FINGERPRINT',
  2: 'CARD',
  15: 'FACE',
};

export interface ZKTecoOptions {
  /**
   * IANA timezone the terminal is configured with. Device timestamps carry no timezone,
   * so without this the same reading would mean a different instant.
   */
  timezone?: string;
  /** Numeric communication key configured on the terminal (0 = none). */
  commKey?: number;
}

/**
 * Adapter for ZKTeco standalone terminals (K40, F18, MB160… over TCP 4370).
 *
 * **Experimental:** implemented against the community-documented protocol and verified with a
 * fake server that speaks it; it still needs validation against physical hardware
 * (see docs/device-integration.md).
 *
 * These devices do not push events, so the platform polls them. The sync cursor is the number
 * of records already downloaded plus a fingerprint of the last one: if the fingerprint does not
 * match (memory cleared, records deleted), the adapter re-reads everything and the ingestion
 * pipeline deduplicates.
 */
export class ZKTecoAdapter implements BiometricDeviceAdapter {
  readonly driver = 'ZKTECO';
  readonly capabilities: AdapterCapabilities = { realtime: false, users: true };

  private readonly client: ZkTcpClient;
  private readonly timezone: string;
  private readonly commKey: number;
  private connected = false;

  constructor(private readonly config: DeviceConnectionConfig) {
    const options = (config.options ?? {}) as ZKTecoOptions;
    this.timezone =
      options.timezone && isValidTimeZone(options.timezone) ? options.timezone : 'UTC';
    this.commKey = Number(config.credentials?.commKey ?? options.commKey ?? 0) || 0;
    this.client = new ZkTcpClient(
      config.host,
      config.port || DEFAULT_PORT,
      config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.client.open();
    try {
      const reply = await this.client.send(ZK_COMMAND.CONNECT);
      this.client.session = reply.sessionId;

      if (reply.command === ZK_COMMAND.ACK_UNAUTH) {
        if (!this.commKey)
          throw new DeviceAuthenticationError('Device requires a communication key');
        const auth = await this.client.send(
          ZK_COMMAND.AUTH,
          makeCommKey(this.commKey, reply.sessionId),
        );
        if (auth.command !== ZK_COMMAND.ACK_OK) {
          throw new DeviceAuthenticationError('Device rejected the communication key');
        }
      } else if (reply.command !== ZK_COMMAND.ACK_OK) {
        throw new DeviceProtocolError(`Unexpected handshake reply ${reply.command}`);
      }
      this.connected = true;
    } catch (error) {
      this.client.close();
      this.connected = false;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client.isOpen()) {
      // Best effort: a terminal that misses the goodbye frees the session on its own timeout.
      await this.client.send(ZK_COMMAND.EXIT).catch(() => undefined);
    }
    this.client.close();
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected && this.client.isOpen();
  }

  async testConnection(): Promise<boolean> {
    try {
      if (!this.isConnected()) await this.connect();
      await this.getDeviceInfo();
      return true;
    } catch {
      this.connected = false;
      return false;
    }
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    this.assertConnected();
    const [serial, model, firmware, sizes, time] = await Promise.all([
      this.option('~SerialNumber'),
      this.option('~DeviceName'),
      this.option('FirmwareVersion'),
      this.client.read(ZK_COMMAND.GET_FREE_SIZES).then(parseSizes),
      this.client.send(ZK_COMMAND.GET_TIME),
    ]);

    return {
      serialNumber: serial || 'unknown',
      manufacturer: 'ZKTeco',
      model: model || 'unknown',
      firmwareVersion: firmware || 'unknown',
      userCount: sizes.users,
      logCount: sizes.records,
      deviceTime:
        time.data.length >= 4
          ? localTimeToInstant(decodeTime(time.data.readUInt32LE(0)), this.timezone)
          : new Date(),
    };
  }

  async getUsers(): Promise<DeviceUser[]> {
    this.assertConnected();
    const data = await this.client.read(ZK_COMMAND.USERTEMP_RRQ, Buffer.from([5, 0, 0, 0, 0]));
    return parseUsers(data).map((user) => ({
      deviceUserId: user.userId,
      name: user.name || user.userId,
      cardNumber: user.cardNumber === '0' ? undefined : user.cardNumber,
      privilege: user.privilege >= 14 ? 'ADMIN' : 'USER',
    }));
  }

  async getAttendanceLogs(from: Date, to: Date): Promise<AttendanceLog[]> {
    const logs = await this.readAllLogs();
    return logs.filter((log) => log.timestamp >= from && log.timestamp <= to);
  }

  /** Cursor: `<recordsRead>:<fingerprint of the last record read>`. */
  async sync(options: SyncOptions = {}): Promise<SyncResult> {
    const fetchedAt = new Date();
    const all = await this.readAllLogs();
    const cursor = parseCursor(options.cursor);

    const continuable =
      cursor !== null &&
      cursor.count <= all.length &&
      (cursor.count === 0 || fingerprint(all[cursor.count - 1]!) === cursor.fingerprint);
    const logs = continuable ? all.slice(cursor.count) : all;
    const last = all.at(-1);

    return {
      logs,
      fetchedAt,
      cursor: `${all.length}:${last ? fingerprint(last) : ''}`,
    };
  }

  private async readAllLogs(): Promise<AttendanceLog[]> {
    this.assertConnected();
    const data = await this.client.read(ZK_COMMAND.ATTLOG_RRQ);
    return parseAttendanceRecords(data).map((record) => this.toLog(record));
  }

  private toLog(record: RawAttendanceRecord): AttendanceLog {
    return {
      deviceUserId: record.userId,
      timestamp: localTimeToInstant(record.localTime, this.timezone),
      punchType: PUNCH_BY_CODE[record.punch] ?? 'UNKNOWN',
      verifyMode: VERIFY_BY_CODE[record.status] ?? 'OTHER',
      raw: { uid: record.uid, punch: record.punch, status: record.status },
    };
  }

  private async option(name: string): Promise<string> {
    const reply = await this.client.send(ZK_COMMAND.OPTIONS_RRQ, Buffer.from(`${name}\0`, 'ascii'));
    return parseOption(reply.data);
  }

  private assertConnected(): void {
    if (!this.isConnected()) throw new DeviceNotConnectedError();
  }
}

function fingerprint(log: AttendanceLog): string {
  return createHash('sha1')
    .update(`${log.deviceUserId}|${log.timestamp.toISOString()}|${log.punchType}`)
    .digest('hex')
    .slice(0, 12);
}

function parseCursor(
  cursor: string | null | undefined,
): { count: number; fingerprint: string } | null {
  if (!cursor) return null;
  const match = /^(\d+):([a-f0-9]*)$/.exec(cursor);
  return match ? { count: Number(match[1]), fingerprint: match[2]! } : null;
}
