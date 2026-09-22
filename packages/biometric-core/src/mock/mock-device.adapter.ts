import type { BiometricDeviceAdapter } from '../adapter';
import {
  DeviceConnectionError,
  DeviceNotConnectedError,
  DeviceProtocolError,
  withTimeout,
} from '../errors';
import type {
  AdapterCapabilities,
  AttendanceLog,
  AttendanceLogListener,
  DeviceConnectionConfig,
  DeviceInfo,
  DeviceUser,
  SyncOptions,
  SyncResult,
  Unsubscribe,
} from '../types';
import type { MockDeviceNetwork } from './mock-device-network';

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Adapter for the simulated terminal. It behaves like a network adapter would: it must
 * connect first, every call can time out, and it only sees devices present on the network.
 */
export class MockDeviceAdapter implements BiometricDeviceAdapter {
  readonly driver = 'MOCK';
  readonly capabilities: AdapterCapabilities = { realtime: true, users: true };

  private connected = false;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: DeviceConnectionConfig,
    private readonly network: MockDeviceNetwork,
  ) {
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async connect(): Promise<void> {
    const device = this.device();
    await this.call(() => device.request(() => undefined), 'connect');
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async testConnection(): Promise<boolean> {
    try {
      if (!this.connected) await this.connect();
      await this.getDeviceInfo();
      return true;
    } catch {
      this.connected = false;
      return false;
    }
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const device = this.connectedDevice();
    return this.call(() => device.request(() => device.readInfo()), 'getDeviceInfo');
  }

  async getUsers(): Promise<DeviceUser[]> {
    const device = this.connectedDevice();
    return this.call(() => device.request(() => device.listUsers()), 'getUsers');
  }

  async getAttendanceLogs(from: Date, to: Date): Promise<AttendanceLog[]> {
    const device = this.connectedDevice();
    return this.call(() => device.request(() => device.readLogs(from, to)), 'getAttendanceLogs');
  }

  /** Cursor "<memoryGeneration>:<nextIndex>", like the record counter of real terminals. */
  async sync(options: SyncOptions = {}): Promise<SyncResult> {
    const device = this.connectedDevice();
    const { generation, index } = parseCursor(options.cursor);
    const read = await this.call(
      () => device.request(() => device.readFromIndex(generation, index)),
      'sync',
    );
    return { logs: read.logs, fetchedAt: new Date(), cursor: `${read.generation}:${read.next}` };
  }

  onAttendanceLog(listener: AttendanceLogListener): Unsubscribe {
    const device = this.device();
    return device.onLog((log) => {
      // A terminal without network keeps punches in memory; they arrive later through sync().
      if (this.connected && device.isOnline()) listener(log);
    });
  }

  private device() {
    const device = this.network.resolve(this.config.host, this.config.port);
    if (!device) {
      throw new DeviceConnectionError(
        `No device answering at ${this.config.host}:${this.config.port}`,
      );
    }
    return device;
  }

  private connectedDevice() {
    if (!this.connected) throw new DeviceNotConnectedError();
    return this.device();
  }

  private async call<T>(fn: () => Promise<T>, operation: string): Promise<T> {
    try {
      return await withTimeout(fn(), this.timeoutMs, operation);
    } catch (error) {
      if (error instanceof DeviceConnectionError) this.connected = false;
      throw error;
    }
  }
}

function parseCursor(cursor: string | null | undefined): { generation: number; index: number } {
  if (!cursor) return { generation: 0, index: 0 };
  const match = /^(\d+):(\d+)$/.exec(cursor);
  if (!match) throw new DeviceProtocolError(`Invalid sync cursor "${cursor}"`);
  return { generation: Number(match[1]), index: Number(match[2]) };
}
