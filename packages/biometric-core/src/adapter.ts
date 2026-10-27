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

  /**
   * Diagnosis only (device:probe): every kind of event the device keeps in the range, counted,
   * and whether the adapter reads it as a punch. It shows a kind of punch the adapter would
   * miss (say, by PIN) before anyone notices missing attendance.
   */
  describeEventKinds?(from: Date, to: Date): Promise<DeviceEventKind[]>;
}

export interface DeviceEventKind {
  /** The device's own code for the kind, e.g. a Hikvision minor in hex ("0x26"). */
  code: string;
  /** What the adapter knows it is, or null when it does not. */
  description: string | null;
  count: number;
  /** Read by sync as a punch. */
  counted: boolean;
}
