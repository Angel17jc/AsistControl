import type { PunchType, VerifyMode } from '@asistcontrol/shared';

/** Everything an adapter needs to reach a device on the LAN. */
export interface DeviceConnectionConfig {
  host: string;
  port: number;
  /** Per-operation timeout. Adapters must never hang the sync pipeline. */
  timeoutMs?: number;
  /** Decrypted credentials (comm key, username/password...). Never logged. */
  credentials?: Record<string, string>;
  /** Driver-specific options (e.g. protocol variant). */
  options?: Record<string, unknown>;
}

export interface DeviceInfo {
  serialNumber: string;
  manufacturer: string;
  model: string;
  firmwareVersion: string;
  userCount: number;
  logCount: number;
  /** Device clock. Used to detect clock drift against the server. */
  deviceTime: Date;
}

export interface DeviceUser {
  /** Identifier enrolled on the device; maps to Employee.biometricId. */
  deviceUserId: string;
  name: string;
  cardNumber?: string;
  privilege: 'USER' | 'ADMIN';
}

/** A raw punch as reported by the device, before validation/normalization. */
export interface AttendanceLog {
  deviceUserId: string;
  timestamp: Date;
  punchType: PunchType;
  verifyMode: VerifyMode;
  /** Original payload, kept for traceability and troubleshooting. */
  raw?: Record<string, unknown>;
}

export interface SyncOptions {
  /**
   * Opaque position returned by the previous sync. Omitted/null = full download.
   * Its meaning is adapter-specific (record index, sequence number, timestamp…): a device
   * clock can jump backwards, so timestamps alone are not a safe cursor for every model.
   */
  cursor?: string | null;
}

export interface SyncResult {
  logs: AttendanceLog[];
  fetchedAt: Date;
  /** Persisted by the platform and passed back unchanged on the next sync. */
  cursor: string | null;
}

export interface AdapterCapabilities {
  /** Device pushes punches as they happen (in addition to polling). */
  realtime: boolean;
  /** Device exposes its enrolled user list. */
  users: boolean;
}

export type AttendanceLogListener = (log: AttendanceLog) => void;
export type Unsubscribe = () => void;
