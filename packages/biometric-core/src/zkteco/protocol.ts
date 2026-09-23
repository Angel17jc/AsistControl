/**
 * ZKTeco "standalone" protocol (the one spoken by K40, F18, MB160… on TCP/UDP 4370).
 *
 * It is not an official public specification: the framing below follows the widely used
 * community implementations (pyzk, zklib). Everything here is **pure** — no sockets — so it
 * can be tested byte by byte and reused by a UDP variant later.
 *
 * Packet (payload of the TCP envelope):
 *   uint16 command | uint16 checksum | uint16 sessionId | uint16 replyId | data…
 */
import type { DeviceLocalTime } from '../device-time';

export const ZK_COMMAND = {
  CONNECT: 1000,
  EXIT: 1001,
  ENABLE_DEVICE: 1002,
  DISABLE_DEVICE: 1003,
  AUTH: 1102,
  PREPARE_DATA: 1500,
  DATA: 1501,
  FREE_DATA: 1502,
  ATTLOG_RRQ: 13,
  USERTEMP_RRQ: 9,
  GET_FREE_SIZES: 50,
  GET_TIME: 201,
  OPTIONS_RRQ: 11,
  ACK_OK: 2000,
  ACK_ERROR: 2001,
  ACK_DATA: 2002,
  ACK_UNAUTH: 2005,
} as const;

/** TCP envelope magic: 0x5050827d followed by the payload length. */
const TCP_MAGIC = 0x7d828050;
export const TCP_HEADER_SIZE = 8;
export const PACKET_HEADER_SIZE = 8;
/** Size of one attendance record in the device memory dump. */
export const ATTENDANCE_RECORD_SIZE = 40;

export interface ZkPacket {
  command: number;
  sessionId: number;
  replyId: number;
  data: Buffer;
}

/**
 * 16-bit one's complement checksum over the packet with the checksum field zeroed,
 * the same scheme used by IP headers.
 */
export function checksum16(buffer: Buffer): number {
  let sum = 0;
  for (let i = 0; i + 1 < buffer.length; i += 2) sum += buffer.readUInt16LE(i);
  if (buffer.length % 2 === 1) sum += buffer[buffer.length - 1]!;
  while (sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16);
  return ~sum & 0xffff;
}

export function buildPacket(packet: ZkPacket): Buffer {
  const body = Buffer.alloc(PACKET_HEADER_SIZE + packet.data.length);
  body.writeUInt16LE(packet.command, 0);
  body.writeUInt16LE(0, 2);
  body.writeUInt16LE(packet.sessionId, 4);
  body.writeUInt16LE(packet.replyId, 6);
  packet.data.copy(body, PACKET_HEADER_SIZE);
  body.writeUInt16LE(checksum16(body), 2);

  const envelope = Buffer.alloc(TCP_HEADER_SIZE + body.length);
  envelope.writeUInt32LE(TCP_MAGIC, 0);
  envelope.writeUInt32LE(body.length, 4);
  body.copy(envelope, TCP_HEADER_SIZE);
  return envelope;
}

export interface DecodeResult {
  packet: ZkPacket;
  /** Bytes consumed from the stream, so the caller can keep the remainder. */
  consumed: number;
}

/** Reads one complete packet from a TCP stream buffer, or null while it is still partial. */
export function decodePacket(stream: Buffer): DecodeResult | null {
  if (stream.length < TCP_HEADER_SIZE) return null;
  if (stream.readUInt32LE(0) !== TCP_MAGIC) throw new Error('Invalid ZKTeco TCP header');

  const bodyLength = stream.readUInt32LE(4);
  const total = TCP_HEADER_SIZE + bodyLength;
  if (stream.length < total || bodyLength < PACKET_HEADER_SIZE) return null;

  const body = stream.subarray(TCP_HEADER_SIZE, total);
  const expected = body.readUInt16LE(2);
  const verified = Buffer.from(body);
  verified.writeUInt16LE(0, 2);
  if (checksum16(verified) !== expected) throw new Error('ZKTeco packet checksum mismatch');

  return {
    packet: {
      command: body.readUInt16LE(0),
      sessionId: body.readUInt16LE(4),
      replyId: body.readUInt16LE(6),
      data: Buffer.from(body.subarray(PACKET_HEADER_SIZE)),
    },
    consumed: total,
  };
}

export function decodeTime(value: number): DeviceLocalTime {
  let t = value;
  const second = t % 60;
  t = Math.floor(t / 60);
  const minute = t % 60;
  t = Math.floor(t / 60);
  const hour = t % 24;
  t = Math.floor(t / 24);
  const day = (t % 31) + 1;
  t = Math.floor(t / 31);
  const month = (t % 12) + 1;
  const year = Math.floor(t / 12) + 2000;
  return { year, month, day, hour, minute, second };
}

export function encodeTime(time: DeviceLocalTime): number {
  const { year, month, day, hour, minute, second } = time;
  return (
    ((year % 100) * 12 * 31 + (month - 1) * 31 + (day - 1)) * (24 * 60 * 60) +
    hour * 3600 +
    minute * 60 +
    second
  );
}

export interface RawAttendanceRecord {
  /** Internal device index (uid), not the enrolled user id. */
  uid: number;
  userId: string;
  /** Verification method reported by the device (1 fingerprint, 2 password, 4 card…). */
  status: number;
  /** Key pressed on the terminal (0 check-in, 1 check-out, 2 break-out…). */
  punch: number;
  localTime: DeviceLocalTime;
}

export function parseAttendanceRecords(data: Buffer): RawAttendanceRecord[] {
  const records: RawAttendanceRecord[] = [];
  for (
    let offset = 0;
    offset + ATTENDANCE_RECORD_SIZE <= data.length;
    offset += ATTENDANCE_RECORD_SIZE
  ) {
    const chunk = data.subarray(offset, offset + ATTENDANCE_RECORD_SIZE);
    const userId = readCString(chunk.subarray(2, 26));
    if (!userId) continue; // empty slot in the device memory
    records.push({
      uid: chunk.readUInt16LE(0),
      userId,
      status: chunk.readUInt8(26),
      localTime: decodeTime(chunk.readUInt32LE(27)),
      punch: chunk.readUInt8(31),
    });
  }
  return records;
}

export interface RawDeviceUser {
  uid: number;
  userId: string;
  name: string;
  /** 0 user, 14 admin. */
  privilege: number;
  cardNumber: string;
}

/** User dumps come as 72-byte records on current firmwares and 28-byte ones on older ones. */
export function parseUsers(data: Buffer): RawDeviceUser[] {
  const size = data.length % 72 === 0 ? 72 : 28;
  const users: RawDeviceUser[] = [];
  for (let offset = 0; offset + size <= data.length; offset += size) {
    const chunk = data.subarray(offset, offset + size);
    const user =
      size === 72
        ? {
            uid: chunk.readUInt16LE(0),
            privilege: chunk.readUInt8(2) & 0x0f,
            name: readCString(chunk.subarray(11, 35)),
            cardNumber: String(chunk.readUInt32LE(35)),
            userId: readCString(chunk.subarray(48, 57)),
          }
        : {
            uid: chunk.readUInt16LE(0),
            privilege: chunk.readUInt8(2) & 0x0f,
            name: readCString(chunk.subarray(11, 19)),
            cardNumber: String(chunk.readUInt32LE(19)),
            userId: String(chunk.readUInt16LE(24)),
          };
    if (user.userId) users.push(user);
  }
  return users;
}

/** `GET_FREE_SIZES` returns a table of counters; only a few positions are documented. */
export function parseSizes(data: Buffer): { users: number; records: number; fingerprints: number } {
  const readAt = (index: number) =>
    data.length >= (index + 1) * 4 ? data.readInt32LE(index * 4) : 0;
  return { users: readAt(4), fingerprints: readAt(2), records: readAt(8) };
}

/** Options are returned as `~Key=Value\0`. */
export function parseOption(data: Buffer): string {
  const text = readCString(data);
  const eq = text.indexOf('=');
  return eq >= 0 ? text.slice(eq + 1).trim() : text.trim();
}

/**
 * Session key expected by `CMD_AUTH` when the terminal has a communication key.
 * Algorithm as implemented by the community clients.
 */
export function makeCommKey(commKey: number, sessionId: number, ticks = 50): Buffer {
  let k = 0;
  for (let i = 0; i < 32; i++) {
    k = ((k << 1) | (commKey & (1 << i) ? 1 : 0)) >>> 0;
  }
  k = (k + sessionId) >>> 0;

  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(k, 0);
  const xored = [0, 1, 2, 3].map((i) => buffer.readUInt8(i) ^ 'ZKSO'.charCodeAt(i));

  // The two 16-bit halves are swapped before the ticks byte is mixed in.
  const swapped = [xored[2]!, xored[3]!, xored[0]!, xored[1]!];
  const b = ticks & 0xff;
  return Buffer.from([swapped[0]! ^ b, swapped[1]! ^ b, b, swapped[3]! ^ b]);
}

export function readCString(buffer: Buffer): string {
  const end = buffer.indexOf(0);
  return buffer
    .subarray(0, end === -1 ? buffer.length : end)
    .toString('ascii')
    .trim();
}
