import { Socket } from 'node:net';
import { DeviceConnectionError, DeviceProtocolError, DeviceTimeoutError } from '../errors';
import { ZK_COMMAND, type ZkPacket, buildPacket, decodePacket } from './protocol';

/**
 * Minimal request/response client for the ZKTeco TCP protocol.
 *
 * The device answers one packet per request, except for bulk reads, which start with
 * PREPARE_DATA, continue with DATA chunks and end with ACK_OK. Requests are serialized:
 * these terminals do not tolerate concurrent commands on the same session.
 */
export class ZkTcpClient {
  private socket: Socket | null = null;
  private buffer = Buffer.alloc(0);
  private pending: {
    resolve: (p: ZkPacket) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private sessionId = 0;
  private replyId = 0;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs: number,
  ) {}

  get session(): number {
    return this.sessionId;
  }

  set session(value: number) {
    this.sessionId = value;
  }

  isOpen(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      socket.setNoDelay(true);
      const onError = (error: Error) => {
        socket.destroy();
        reject(
          new DeviceConnectionError(`Cannot reach ${this.host}:${this.port} (${error.message})`),
        );
      };
      socket.once('error', onError);
      socket.setTimeout(this.timeoutMs, () => onError(new Error('connection timed out')));

      socket.connect(this.port, this.host, () => {
        socket.setTimeout(0);
        socket.off('error', onError);
        socket.on('data', (chunk) => this.onData(chunk));
        socket.on('error', (error) => this.failPending(new DeviceConnectionError(error.message)));
        socket.on('close', () =>
          this.failPending(new DeviceConnectionError('Connection closed by device')),
        );
        this.socket = socket;
        this.buffer = Buffer.alloc(0);
        resolve();
      });
    });
  }

  close(): void {
    this.failPending(new DeviceConnectionError('Connection closed'));
    this.socket?.destroy();
    this.socket = null;
    this.sessionId = 0;
    this.replyId = 0;
  }

  /** Sends a command and resolves with the single packet the device replies. */
  send(command: number, data: Buffer = Buffer.alloc(0)): Promise<ZkPacket> {
    return this.enqueue(() => this.transmit(command, data));
  }

  /**
   * Bulk read: returns the payload of a PREPARE_DATA/DATA/ACK_OK exchange, or the inline
   * data when the device is small enough to answer in a single packet.
   */
  read(command: number, data: Buffer = Buffer.alloc(0)): Promise<Buffer> {
    return this.enqueue(async () => {
      const first = await this.transmit(command, data);
      if (first.command === ZK_COMMAND.DATA) return first.data;
      if (first.command !== ZK_COMMAND.PREPARE_DATA) {
        // Some firmwares answer ACK_OK with the payload inline when there is little data.
        if (first.command === ZK_COMMAND.ACK_OK) return first.data;
        throw new DeviceProtocolError(`Unexpected reply ${first.command} to bulk read ${command}`);
      }

      const expected = first.data.length >= 4 ? first.data.readUInt32LE(0) : 0;
      const chunks: Buffer[] = [];
      let received = 0;
      while (received < expected) {
        const packet = await this.receive();
        if (packet.command === ZK_COMMAND.ACK_OK) break;
        if (packet.command !== ZK_COMMAND.DATA) {
          throw new DeviceProtocolError(`Unexpected packet ${packet.command} while reading data`);
        }
        chunks.push(packet.data);
        received += packet.data.length;
      }
      if (received >= expected) await this.receive().catch(() => undefined); // trailing ACK_OK
      return Buffer.concat(chunks);
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async transmit(command: number, data: Buffer): Promise<ZkPacket> {
    const socket = this.socket;
    if (!socket || socket.destroyed) throw new DeviceConnectionError('Not connected');
    this.replyId = (this.replyId + 1) & 0xffff;
    socket.write(buildPacket({ command, sessionId: this.sessionId, replyId: this.replyId, data }));

    const packet = await this.receive();
    if (packet.command === ZK_COMMAND.ACK_ERROR) {
      throw new DeviceProtocolError(`Device rejected command ${command}`);
    }
    return packet;
  }

  private receive(): Promise<ZkPacket> {
    if (this.pending) throw new DeviceProtocolError('Concurrent read on the same session');
    return new Promise<ZkPacket>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new DeviceTimeoutError(`Device did not answer within ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending = { resolve, reject, timer };
      this.drain();
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.drain();
  }

  private drain(): void {
    while (this.pending) {
      let decoded;
      try {
        decoded = decodePacket(this.buffer);
      } catch (error) {
        this.failPending(new DeviceProtocolError((error as Error).message));
        return;
      }
      if (!decoded) return;
      this.buffer = this.buffer.subarray(decoded.consumed);
      const waiter = this.pending;
      this.pending = null;
      clearTimeout(waiter.timer);
      waiter.resolve(decoded.packet);
    }
  }

  private failPending(error: Error): void {
    const waiter = this.pending;
    this.pending = null;
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }
}
