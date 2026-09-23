import { describe, expect, it } from 'vitest';
import { localTimeToInstant, timezoneOffsetMinutes } from '../device-time';
import {
  ZK_COMMAND,
  buildPacket,
  checksum16,
  decodePacket,
  decodeTime,
  encodeTime,
  makeCommKey,
  parseAttendanceRecords,
  parseOption,
  parseSizes,
  parseUsers,
} from './protocol';
import { attendanceRecord, userRecord } from './test-fixtures';

describe('packet framing', () => {
  it('round-trips a packet through the TCP envelope', () => {
    const data = Buffer.from('hello');
    const decoded = decodePacket(
      buildPacket({ command: ZK_COMMAND.CONNECT, sessionId: 7, replyId: 3, data }),
    );
    expect(decoded?.packet).toEqual({
      command: ZK_COMMAND.CONNECT,
      sessionId: 7,
      replyId: 3,
      data,
    });
  });

  it('returns null while the packet is still incomplete', () => {
    const full = buildPacket({
      command: ZK_COMMAND.ACK_OK,
      sessionId: 1,
      replyId: 1,
      data: Buffer.alloc(64),
    });
    expect(decodePacket(full.subarray(0, 4))).toBeNull();
    expect(decodePacket(full.subarray(0, full.length - 1))).toBeNull();
    expect(decodePacket(full)).not.toBeNull();
  });

  it('reports how many bytes it consumed so the stream can keep the rest', () => {
    const first = buildPacket({
      command: ZK_COMMAND.DATA,
      sessionId: 1,
      replyId: 1,
      data: Buffer.from('a'),
    });
    const second = buildPacket({
      command: ZK_COMMAND.ACK_OK,
      sessionId: 1,
      replyId: 2,
      data: Buffer.alloc(0),
    });
    const decoded = decodePacket(Buffer.concat([first, second]))!;
    expect(decoded.consumed).toBe(first.length);
    expect(
      decodePacket(Buffer.concat([first, second]).subarray(decoded.consumed))!.packet.command,
    ).toBe(ZK_COMMAND.ACK_OK);
  });

  it('rejects a corrupted packet', () => {
    const packet = buildPacket({
      command: ZK_COMMAND.ACK_OK,
      sessionId: 1,
      replyId: 1,
      data: Buffer.from('data'),
    });
    packet.writeUInt8(packet.readUInt8(packet.length - 1) ^ 0xff, packet.length - 1);
    expect(() => decodePacket(packet)).toThrow(/checksum/);
  });

  it('rejects a foreign TCP header', () => {
    expect(() => decodePacket(Buffer.alloc(16, 1))).toThrow(/Invalid ZKTeco TCP header/);
  });

  it('computes a checksum that verifies to zero-complement', () => {
    expect(checksum16(Buffer.from([0x01, 0x02, 0x03, 0x04]))).toBeGreaterThan(0);
    expect(checksum16(Buffer.from([0xff, 0xff]))).toBe(0);
  });
});

describe('device clock', () => {
  it('round-trips a local timestamp', () => {
    const time = { year: 2026, month: 9, day: 21, hour: 8, minute: 2, second: 35 };
    expect(decodeTime(encodeTime(time))).toEqual(time);
  });

  it('interprets device wall-clock time in the device timezone', () => {
    const instant = localTimeToInstant(
      { year: 2026, month: 9, day: 21, hour: 8, minute: 2, second: 0 },
      'America/Guayaquil',
    );
    expect(instant.toISOString()).toBe('2026-09-21T13:02:00.000Z');
  });

  it('handles a timezone with daylight saving on both sides of the change', () => {
    const winter = localTimeToInstant(
      { year: 2026, month: 1, day: 15, hour: 8, minute: 0, second: 0 },
      'Europe/Madrid',
    );
    const summer = localTimeToInstant(
      { year: 2026, month: 7, day: 15, hour: 8, minute: 0, second: 0 },
      'Europe/Madrid',
    );
    expect(winter.toISOString()).toBe('2026-01-15T07:00:00.000Z');
    expect(summer.toISOString()).toBe('2026-07-15T06:00:00.000Z');
    expect(timezoneOffsetMinutes(Date.UTC(2026, 6, 15), 'America/Guayaquil')).toBe(-300);
  });
});

describe('attendance records', () => {
  it('parses a record with its user, punch key and verification method', () => {
    const data = attendanceRecord({
      uid: 12,
      userId: '1001',
      status: 1,
      punch: 0,
      time: { year: 2026, month: 9, day: 21, hour: 8, minute: 2, second: 35 },
    });
    expect(parseAttendanceRecords(data)).toEqual([
      {
        uid: 12,
        userId: '1001',
        status: 1,
        punch: 0,
        localTime: { year: 2026, month: 9, day: 21, hour: 8, minute: 2, second: 35 },
      },
    ]);
  });

  it('skips empty slots and ignores a truncated tail', () => {
    const buffer = Buffer.concat([
      Buffer.alloc(40),
      attendanceRecord({ userId: '7', punch: 1 }),
      Buffer.alloc(13, 0xab),
    ]);
    const records = parseAttendanceRecords(buffer);
    expect(records).toHaveLength(1);
    expect(records[0]!.userId).toBe('7');
  });
});

describe('users', () => {
  it('parses 72-byte user records', () => {
    const users = parseUsers(
      Buffer.concat([
        userRecord({ uid: 1, userId: '1001', name: 'ANGEL CONFORME', privilege: 14 }),
        userRecord({ uid: 2, userId: '1002', name: 'MARIA VERA' }),
      ]),
    );
    expect(users).toEqual([
      { uid: 1, userId: '1001', name: 'ANGEL CONFORME', privilege: 14, cardNumber: '0' },
      { uid: 2, userId: '1002', name: 'MARIA VERA', privilege: 0, cardNumber: '0' },
    ]);
  });
});

describe('device options', () => {
  it('reads the value of an option reply', () => {
    expect(parseOption(Buffer.from('~SerialNumber=6040154200001\0', 'ascii'))).toBe(
      '6040154200001',
    );
    expect(parseOption(Buffer.from('K40\0', 'ascii'))).toBe('K40');
  });

  it('reads the counters table', () => {
    const data = Buffer.alloc(80);
    data.writeInt32LE(120, 4 * 4);
    data.writeInt32LE(5321, 8 * 4);
    expect(parseSizes(data)).toMatchObject({ users: 120, records: 5321 });
  });
});

describe('makeCommKey', () => {
  it('derives a deterministic 4-byte key that depends on the communication key', () => {
    const a = makeCommKey(123456, 42);
    expect(a).toHaveLength(4);
    expect(a.equals(makeCommKey(123456, 42))).toBe(true);
    expect(a.equals(makeCommKey(654321, 42))).toBe(false);
    expect(a.equals(makeCommKey(123457, 42))).toBe(false);
  });

  it('carries the ticks byte in the third position', () => {
    expect(makeCommKey(123456, 42, 77)[2]).toBe(77);
  });

  it('only reacts to the high byte of the session id', () => {
    // Quirk of the reference algorithm: the byte where the low part of the session lands is
    // overwritten by the ticks value, so 42 and 43 produce the same key. Kept as-is on purpose:
    // the device implements this exact scheme.
    expect(makeCommKey(123456, 42).equals(makeCommKey(123456, 43))).toBe(true);
    expect(makeCommKey(123456, 42).equals(makeCommKey(123456, 1066))).toBe(false);
  });
});
