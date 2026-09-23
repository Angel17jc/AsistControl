import type { DeviceLocalTime } from '../device-time';
import { encodeTime } from './protocol';

/** Builders for byte-level fixtures shared by the protocol and adapter tests. */

const DEFAULT_TIME: DeviceLocalTime = {
  year: 2026,
  month: 9,
  day: 21,
  hour: 8,
  minute: 0,
  second: 0,
};

export function attendanceRecord(options: {
  uid?: number;
  userId: string;
  status?: number;
  punch?: number;
  time?: DeviceLocalTime;
}): Buffer {
  const record = Buffer.alloc(40);
  record.writeUInt16LE(options.uid ?? 1, 0);
  record.write(options.userId, 2, 'ascii');
  record.writeUInt8(options.status ?? 1, 26);
  record.writeUInt32LE(encodeTime(options.time ?? DEFAULT_TIME), 27);
  record.writeUInt8(options.punch ?? 0, 31);
  return record;
}

export function userRecord(options: {
  uid: number;
  userId: string;
  name: string;
  privilege?: number;
}): Buffer {
  const record = Buffer.alloc(72);
  record.writeUInt16LE(options.uid, 0);
  record.writeUInt8(options.privilege ?? 0, 2);
  record.write(options.name, 11, 'ascii');
  record.writeUInt32LE(0, 35);
  record.write(options.userId, 48, 'ascii');
  return record;
}

export function sizesTable(users: number, records: number): Buffer {
  const data = Buffer.alloc(80);
  data.writeInt32LE(users, 16);
  data.writeInt32LE(records, 32);
  return data;
}
