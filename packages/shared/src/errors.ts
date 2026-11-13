import type { RequestStatus } from './domain';
import type { Role } from './rbac';

/** One broken rule of a request: `field` is the property's path, `rule` the validator's name. */
export interface ApiViolation {
  field: string;
  rule: string;
}

/**
 * Why the API refused a request, as data: `code` says what happened and `params` carries the
 * values worth mentioning. Each client words it in its own language (ADR 0014); `message` stays
 * in English for logs and for whoever calls the API by hand. A code never changes meaning.
 */
export interface ApiErrorParams {
  // Errors without a code of their own (framework, proxy), by HTTP status.
  BAD_REQUEST: undefined;
  UNAUTHORIZED: undefined;
  FORBIDDEN: undefined;
  NOT_FOUND: undefined;
  CONFLICT: undefined;
  TOO_MANY_REQUESTS: undefined;
  REQUEST_FAILED: undefined;
  INTERNAL_ERROR: undefined;

  VALIDATION_FAILED: { violations: ApiViolation[] };
  /** A unique value is taken; `fields` are the properties of that constraint. */
  DUPLICATE_RECORD: { fields: string[] };
  /** Points to a record that does not exist, or is still referenced by others. */
  RECORD_IN_USE: undefined;

  // Sessions and passwords
  INVALID_CREDENTIALS: undefined;
  SESSION_EXPIRED: undefined;
  CURRENT_PASSWORD_INCORRECT: undefined;
  PASSWORD_UNCHANGED: undefined;
  PASSWORD_CHANGED_MEANWHILE: undefined;
  PASSWORD_CHANGE_REQUIRED: undefined;
  /** The password link was used, replaced by a newer one, or its account was disabled. */
  PASSWORD_LINK_INVALID: undefined;
  PASSWORD_LINK_EXPIRED: { purpose: 'RESET' | 'INVITE' };

  // Accounts
  USER_NOT_FOUND: undefined;
  SELF_ACCOUNT_CHANGE: undefined;
  ACCOUNT_NEEDS_EMPLOYEE: { role: Role };
  ADMIN_ACCOUNTS_RESTRICTED: undefined;

  // Employees and organization
  EMPLOYEE_NOT_FOUND: undefined;
  EMPLOYEE_OUT_OF_SCOPE: undefined;
  SUPERVISOR_IS_SELF: undefined;
  RELATED_RECORD_NOT_FOUND: {
    record: 'department' | 'position' | 'contractType' | 'supervisor' | 'schedule';
  };
  DEPARTMENT_NOT_FOUND: undefined;
  DEPARTMENT_IN_USE: { employees: number };
  POSITION_NOT_FOUND: undefined;
  POSITION_IN_USE: { employees: number };
  CONTRACT_TYPE_NOT_FOUND: undefined;
  CONTRACT_TYPE_IN_USE: { name: string; employees: number };

  // Attendance
  UNMATCHED_PUNCHES_FORBIDDEN: undefined;
  PUNCH_IN_FUTURE: undefined;
  PUNCHES_AT_SAME_TIME: undefined;
  MANUAL_PUNCH_EXISTS: undefined;
  EVENT_NOT_FOUND: undefined;
  EVENT_ALREADY_VOIDED: undefined;
  DATE_RANGE_INVERTED: undefined;
  DATE_RANGE_TOO_LONG: { maxDays: number };

  // Schedules
  SHIFT_NOT_FOUND: undefined;
  SHIFTS_NOT_FOUND: undefined;
  SCHEDULE_NOT_FOUND: undefined;
  HOLIDAY_NOT_FOUND: undefined;
  BREAK_INCOMPLETE: undefined;
  FLEXIBLE_SHIFT_OVERNIGHT: undefined;
  ASSIGNMENT_NOT_FOUND: undefined;
  ASSIGNMENT_DATE_CONFLICT: undefined;
  ASSIGNMENT_NOT_LATEST: undefined;
  ASSIGNMENT_TOO_OLD: { maxDays: number };

  // Devices
  DEVICE_NOT_FOUND: undefined;
  DEVICE_DISABLED: undefined;
  DEVICE_ADDRESS_IN_USE: { name: string; host: string; port: number };
  DRIVER_NOT_AVAILABLE: { driver: string };
  SYNC_ALREADY_RUNNING: undefined;
  MOCK_DEVICES_DISABLED: undefined;
  SIMULATION_MOCK_ONLY: undefined;
  SIMULATION_NO_BIOMETRIC_ID: undefined;
  SIMULATION_TARGET_REQUIRED: undefined;

  // Leave and vacations
  LEAVE_NOT_FOUND: undefined;
  LEAVE_EMPLOYEE_REQUIRED: undefined;
  LEAVE_ENDS_BEFORE_START: undefined;
  LEAVE_TOO_LONG: { maxDays: number };
  LEAVE_OVERLAP: undefined;
  LEAVE_ALREADY_DECIDED: { status: RequestStatus };
  LEAVE_SELF_REVIEW: undefined;
  LEAVE_CANCEL_FORBIDDEN: undefined;
  VACATION_NO_COUNTABLE_DAYS: undefined;
  VACATION_INSUFFICIENT_BALANCE: {
    availableDays: number;
    requestedDays: number;
    startDate: string;
  };

  // Overtime, notifications, reports
  OVERTIME_NOT_FOUND: undefined;
  OVERTIME_SELF_REVIEW: undefined;
  OVERTIME_ALREADY_DECIDED: { status: RequestStatus };
  NOTIFICATION_NOT_FOUND: undefined;
  REPORT_UNKNOWN: undefined;
  REPORT_FORMAT_UNSUPPORTED: undefined;
}

export type ApiErrorCode = keyof ApiErrorParams;
