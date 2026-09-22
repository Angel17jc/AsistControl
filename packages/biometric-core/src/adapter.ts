import type {
  AdapterCapabilities,
  AttendanceLog,
  AttendanceLogListener,
  DeviceInfo,
  DeviceUser,
  SyncOptions,
  SyncResult,
  Unsubscribe,
} from './types';

/**
 * Contract every biometric device integration implements.
 *
 * The rest of the platform only depends on this interface: adding a manufacturer means
 * writing a new adapter and registering it, never touching the sync pipeline.
 * Adapters are transport translators — they MUST NOT persist data or apply business rules.
 * Failures are reported by throwing a subclass of `BiometricDeviceError`.
 */
export interface BiometricDeviceAdapter {
  readonly driver: string;
  readonly capabilities: AdapterCapabilities;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  /** Never throws: returns false when the device is unreachable. */
  testConnection(): Promise<boolean>;

  getDeviceInfo(): Promise<DeviceInfo>;
  getUsers(): Promise<DeviceUser[]>;
  getAttendanceLogs(from: Date, to: Date): Promise<AttendanceLog[]>;

  /** Incremental download of logs since the last cursor. */
  sync(options?: SyncOptions): Promise<SyncResult>;

  /** Only available when `capabilities.realtime` is true. */
  onAttendanceLog?(listener: AttendanceLogListener): Unsubscribe;
}
