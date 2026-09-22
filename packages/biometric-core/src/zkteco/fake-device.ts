import { type Server, type Socket, createServer } from 'node:net';
import { ZK_COMMAND, type ZkPacket, buildPacket, decodePacket, encodeTime } from './protocol';
import { attendanceRecord, sizesTable, userRecord } from './test-fixtures';

export interface FakeDeviceOptions {
  /** Communication key the device demands; 0 = open device. */
  commKey?: number;
  serialNumber?: string;
  model?: string;
  /** Records currently in the device memory. */
  records?: Parameters<typeof attendanceRecord>[0][];
  users?: Parameters<typeof userRecord>[0][];
  /** Split bulk payloads in chunks of this size, to exercise stream reassembly. */
  chunkSize?: number;
  /** Commands the device will not answer at all (to test timeouts). */
  silentCommands?: number[];
  /** Corrupt the next reply's checksum. */
  corruptNextReply?: boolean;
}

/**
 * A TCP server that speaks the ZKTeco protocol, used to test the adapter without hardware.
 * It is deliberately literal: framing, session handshake, auth and PREPARE_DATA/DATA flows.
 */
export class FakeZkDevice {
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();
  options: FakeDeviceOptions;

  constructor(options: FakeDeviceOptions = {}) {
    this.options = {
      serialNumber: '6040154200001',
      model: 'K40',
      records: [],
      users: [],
      ...options,
    };
  }

  listen(): Promise<number> {
    return new Promise((resolve) => {
      this.server = createServer((socket) => this.handle(socket));
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server!.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
    this.server = null;
  }

  private handle(socket: Socket): void {
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    let stream = Buffer.alloc(0);
    let session = 0;
    let authenticated = !this.options.commKey;

    socket.on('data', (chunk) => {
      stream = Buffer.concat([stream, chunk]);
      for (;;) {
        const decoded = decodePacket(stream);
        if (!decoded) return;
        stream = stream.subarray(decoded.consumed);
        const request = decoded.packet;
        if (this.options.silentCommands?.includes(request.command)) continue;

        if (request.command === ZK_COMMAND.CONNECT) {
          session = 1234;
          this.reply(
            socket,
            authenticated ? ZK_COMMAND.ACK_OK : ZK_COMMAND.ACK_UNAUTH,
            session,
            request,
          );
          continue;
        }
        if (request.command === ZK_COMMAND.AUTH) {
          authenticated = request.data.length === 4;
          this.reply(
            socket,
            authenticated ? ZK_COMMAND.ACK_OK : ZK_COMMAND.ACK_ERROR,
            session,
            request,
          );
          continue;
        }
        if (!authenticated) {
          this.reply(socket, ZK_COMMAND.ACK_UNAUTH, session, request);
          continue;
        }
        this.answer(socket, session, request);
      }
    });
  }

  private answer(socket: Socket, session: number, request: ZkPacket): void {
    switch (request.command) {
      case ZK_COMMAND.OPTIONS_RRQ: {
        const name = request.data.toString('ascii').replace(/\0.*$/, '');
        const value =
          name === '~SerialNumber'
            ? this.options.serialNumber
            : name === '~DeviceName'
              ? this.options.model
              : 'Ver 6.60';
        this.reply(
          socket,
          ZK_COMMAND.ACK_OK,
          session,
          request,
          Buffer.from(`${name}=${value}\0`, 'ascii'),
        );
        return;
      }
      case ZK_COMMAND.GET_TIME:
        this.reply(
          socket,
          ZK_COMMAND.ACK_OK,
          session,
          request,
          encodeUInt32(
            encodeTime({ year: 2026, month: 9, day: 21, hour: 10, minute: 30, second: 0 }),
          ),
        );
        return;
      case ZK_COMMAND.GET_FREE_SIZES:
        this.reply(
          socket,
          ZK_COMMAND.ACK_OK,
          session,
          request,
          sizesTable(this.options.users!.length, this.options.records!.length),
        );
        return;
      case ZK_COMMAND.ATTLOG_RRQ:
        this.bulk(
          socket,
          session,
          request,
          Buffer.concat(this.options.records!.map(attendanceRecord)),
        );
        return;
      case ZK_COMMAND.USERTEMP_RRQ:
        this.bulk(socket, session, request, Buffer.concat(this.options.users!.map(userRecord)));
        return;
      case ZK_COMMAND.EXIT:
        this.reply(socket, ZK_COMMAND.ACK_OK, session, request);
        return;
      default:
        this.reply(socket, ZK_COMMAND.ACK_ERROR, session, request);
    }
  }

  /** PREPARE_DATA with the total size, then DATA chunks, then ACK_OK. */
  private bulk(socket: Socket, session: number, request: ZkPacket, payload: Buffer): void {
    this.reply(socket, ZK_COMMAND.PREPARE_DATA, session, request, encodeUInt32(payload.length));
    const size = (this.options.chunkSize ?? payload.length) || 1;
    for (let offset = 0; offset < payload.length; offset += size) {
      this.reply(
        socket,
        ZK_COMMAND.DATA,
        session,
        request,
        payload.subarray(offset, offset + size),
      );
    }
    this.reply(socket, ZK_COMMAND.ACK_OK, session, request);
  }

  private reply(
    socket: Socket,
    command: number,
    sessionId: number,
    request: ZkPacket,
    data: Buffer = Buffer.alloc(0),
  ): void {
    const packet = buildPacket({ command, sessionId, replyId: request.replyId, data });
    if (this.options.corruptNextReply) {
      this.options.corruptNextReply = false;
      packet.writeUInt8(packet.readUInt8(packet.length - 1) ^ 0xff, packet.length - 1);
    }
    socket.write(packet);
  }
}

function encodeUInt32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}
