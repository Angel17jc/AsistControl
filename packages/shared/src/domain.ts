/**
 * Domain enumerations shared by the API and the web client.
 * Values MUST stay in sync with the Prisma enums (apps/api/prisma/schema.prisma);
 * a unit test in the API enforces it.
 */
const values = <T extends string>(...v: T[]): readonly T[] => Object.freeze(v);

export const EMPLOYEE_STATUSES = values('ACTIVE', 'INACTIVE', 'SUSPENDED');
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const DEVICE_STATUSES = values('ONLINE', 'OFFLINE', 'SYNCING', 'ERROR', 'DISABLED');
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

/** Adapter drivers known by the platform. A new manufacturer adds a value here. */
export const DEVICE_DRIVERS = values('MOCK', 'ZKTECO', 'HIKVISION');
export type DeviceDriver = (typeof DEVICE_DRIVERS)[number];

export const PUNCH_TYPES = values('CHECK_IN', 'CHECK_OUT', 'BREAK_OUT', 'BREAK_IN', 'UNKNOWN');
export type PunchType = (typeof PUNCH_TYPES)[number];

export const VERIFY_MODES = values('FINGERPRINT', 'FACE', 'CARD', 'PASSWORD', 'OTHER');
export type VerifyMode = (typeof VERIFY_MODES)[number];

export const EVENT_SOURCES = values('DEVICE', 'MANUAL', 'IMPORT');
export type EventSource = (typeof EVENT_SOURCES)[number];

export const DAY_TYPES = values('WORKDAY', 'REST_DAY', 'HOLIDAY');
export type DayType = (typeof DAY_TYPES)[number];

export const ATTENDANCE_STATUSES = values(
  'PRESENT',
  'LATE',
  'INCOMPLETE',
  'ABSENT',
  'ON_LEAVE',
  'REST_DAY',
  'HOLIDAY',
  'NO_SCHEDULE',
);
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_ANOMALIES = values(
  'LATE_ARRIVAL',
  'EARLY_LEAVE',
  'OVERTIME',
  'MISSING_CHECK_IN',
  'MISSING_CHECK_OUT',
  'DUPLICATE_PUNCH',
  'OUT_OF_SCHEDULE_PUNCH',
  'SHORT_BREAK',
  'WORKED_ON_REST_DAY',
  'WORKED_ON_HOLIDAY',
);
export type AttendanceAnomaly = (typeof ATTENDANCE_ANOMALIES)[number];

export const SYNC_STATUSES = values('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export const SYNC_TRIGGERS = values('MANUAL', 'SCHEDULED', 'REALTIME');
export type SyncTrigger = (typeof SYNC_TRIGGERS)[number];

export const LEAVE_TYPES = values('PERSONAL', 'MEDICAL', 'VACATION', 'OTHER');
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const REQUEST_STATUSES = values('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** How vacation days are earned: credited on each anniversary, or a twelfth per month. */
export const VACATION_ACCRUALS = values('ANNUAL', 'MONTHLY');
export type VacationAccrual = (typeof VACATION_ACCRUALS)[number];

/** Which days a vacation takes from the balance. */
export const VACATION_DAY_COUNTINGS = values('CALENDAR_DAYS', 'WORKING_DAYS');
export type VacationDayCounting = (typeof VACATION_DAY_COUNTINGS)[number];

/** What a notification is about. The text is rendered by the client from `type` + data. */
export const NOTIFICATION_TYPES = values(
  'DEVICE_DOWN',
  'DEVICE_RECOVERED',
  'LEAVE_REQUESTED',
  'LEAVE_REVIEWED',
  'VACATION_EXPIRING',
);
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const OVERTIME_KINDS = values('REGULAR', 'REST_DAY', 'HOLIDAY');
export type OvertimeKind = (typeof OVERTIME_KINDS)[number];
