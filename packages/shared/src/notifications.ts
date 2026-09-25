import type { DeviceStatus, LeaveType, NotificationType } from './domain';

/**
 * Notifications carry data, not sentences: the API stays language-neutral and each client
 * renders the text (see docs/adr/0007-notifications.md). Every type has its own data shape.
 */
export interface NotificationDataByType {
  /** A device that had been online stopped answering or started failing. */
  DEVICE_DOWN: {
    deviceName: string;
    status: Extract<DeviceStatus, 'OFFLINE' | 'ERROR'>;
    /** `CODE: detail` as stored on the device. */
    error: string | null;
  };
  /** The same device is back online after a DEVICE_DOWN. */
  DEVICE_RECOVERED: {
    deviceName: string;
  };
  /** A request awaits the recipient's review. */
  LEAVE_REQUESTED: {
    employeeName: string;
    leaveType: LeaveType;
    startsAt: string;
    endsAt: string;
  };
  /** The recipient's request, or one they filed, was decided. */
  LEAVE_REVIEWED: {
    employeeName: string;
    leaveType: LeaveType;
    startsAt: string;
    endsAt: string;
    decision: 'APPROVED' | 'REJECTED';
    note: string | null;
  };
  /** Some of the recipient's vacation days expire soon if they are not used (ADR 0009). */
  VACATION_EXPIRING: {
    employeeName: string;
    days: number;
    /** `YYYY-MM-DD`: the first day those days can no longer be used. */
    expiresOn: string;
  };
}

/** A notification as the API returns it and pushes it. Narrow on `type` to read `data`. */
export type AppNotification = {
  [T in NotificationType]: {
    id: string;
    type: T;
    data: NotificationDataByType[T];
    /** Entity it is about, e.g. `Device` / `LeaveRequest`, and its id. */
    entity: string | null;
    entityId: string | null;
    readAt: string | null;
    createdAt: string;
  };
}[NotificationType];
