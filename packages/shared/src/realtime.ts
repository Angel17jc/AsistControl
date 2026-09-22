import type { AttendanceStatus, DeviceStatus, PunchType, SyncStatus } from './domain';

/** Socket.IO namespace and event names used between the API and the dashboard. */
export const REALTIME_NAMESPACE = '/realtime';

export const REALTIME_EVENTS = Object.freeze({
  ATTENDANCE_EVENT_CREATED: 'attendance.event.created',
  ATTENDANCE_RECORD_UPDATED: 'attendance.record.updated',
  DEVICE_STATUS_CHANGED: 'device.status.changed',
  DEVICE_SYNC_FINISHED: 'device.sync.finished',
} as const);

export interface AttendanceEventCreatedPayload {
  id: string;
  occurredAt: string;
  punchType: PunchType;
  deviceId: string | null;
  deviceName: string | null;
  deviceUserId: string;
  employee: { id: string; fullName: string; employeeCode: string } | null;
}

export interface AttendanceRecordUpdatedPayload {
  employeeId: string;
  workDate: string;
  status: AttendanceStatus;
  lateMinutes: number;
  workedMinutes: number;
}

export interface DeviceStatusChangedPayload {
  deviceId: string;
  name: string;
  status: DeviceStatus;
  lastError: string | null;
  lastSyncAt: string | null;
}

export interface DeviceSyncFinishedPayload {
  deviceId: string;
  syncLogId: string;
  status: SyncStatus;
  recordsReceived: number;
  recordsProcessed: number;
  recordsDuplicated: number;
  recordsRejected: number;
}

export interface RealtimeEventMap {
  [REALTIME_EVENTS.ATTENDANCE_EVENT_CREATED]: AttendanceEventCreatedPayload;
  [REALTIME_EVENTS.ATTENDANCE_RECORD_UPDATED]: AttendanceRecordUpdatedPayload;
  [REALTIME_EVENTS.DEVICE_STATUS_CHANGED]: DeviceStatusChangedPayload;
  [REALTIME_EVENTS.DEVICE_SYNC_FINISHED]: DeviceSyncFinishedPayload;
}
