import type {
  AttendanceAnomaly,
  AttendanceEventCreatedPayload,
  AttendanceStatus,
  DeviceDriver,
  DeviceStatus,
  EmployeeStatus,
  LeaveType,
  RequestStatus,
  SyncStatus,
  SyncTrigger,
  VacationAccrual,
  VacationDayCounting,
} from '@asistcontrol/shared';

/** Response shapes of the endpoints the web client consumes. */

export interface AttendanceRecordRow {
  id: string;
  employeeId: string;
  workDate: string;
  status: AttendanceStatus;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  anomalies: AttendanceAnomaly[];
  isFinal: boolean;
  employee: {
    id: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
    department: { name: string } | null;
  };
}

export interface AttendanceEventRow extends AttendanceEventCreatedPayload {
  source: 'DEVICE' | 'MANUAL' | 'IMPORT';
  note: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface EmployeeRow {
  id: string;
  employeeCode: string;
  identification: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  hireDate: string;
  status: EmployeeStatus;
  biometricId: string | null;
  department: { id: string; name: string } | null;
  position: { id: string; name: string } | null;
  contractType: { id: string; name: string } | null;
  supervisor: { id: string; firstName: string; lastName: string } | null;
}

export interface ContractTypeRow {
  id: string;
  name: string;
  vacationDaysPerYear: number;
  vacationAccrual: VacationAccrual;
  vacationDayCounting: VacationDayCounting;
  seniority: { afterYears: number; extraDaysPerYear: number; maxExtraDays: number } | null;
  allowNegativeVacationBalance: boolean;
  /** How many employees use it (list only). */
  employees?: number;
}

/** GET /employees/:id/vacation-balance. The balance is computed by the API on every read. */
export interface VacationBalance {
  employeeId: string;
  asOf: string;
  contractType: ContractTypeRow | null;
  accrual: {
    completedServiceYears: number;
    currentYearEntitlement: number;
    nextCreditOn: string | null;
  } | null;
  accruedDays: number;
  adjustmentDays: number;
  usedDays: number;
  scheduledDays: number;
  pendingDays: number;
  availableDays: number;
  adjustments: { id: string; days: number; reason: string; createdAt: string }[];
}

export interface DeviceRow {
  id: string;
  name: string;
  driver: DeviceDriver;
  manufacturer: string;
  model: string;
  serialNumber: string | null;
  host: string;
  port: number;
  location: string | null;
  status: DeviceStatus;
  /** Non-secret driver options (timeoutMs, timezone, protocol…). */
  config: Record<string, unknown>;
  lastSyncAt: string | null;
  lastSeenAt: string | null;
  lastError: string | null;
  hasCredentials: boolean;
  registeredAt: string;
}

export interface SyncLogRow {
  id: string;
  trigger: SyncTrigger;
  status: SyncStatus;
  startedAt: string;
  finishedAt: string | null;
  recordsReceived: number;
  recordsProcessed: number;
  recordsDuplicated: number;
  recordsRejected: number;
  recordsUnmatched: number;
  errorMessage: string | null;
  device: { id: string; name: string };
}

export interface SimulatorState {
  online: boolean;
  autoGenerating: boolean;
  latencyMs: number;
  duplicateOnRead: boolean;
  enrolledUsers: number;
  storedLogs: number;
}

export interface LeaveRow {
  id: string;
  type: LeaveType;
  startsAt: string;
  endsAt: string;
  reason: string;
  status: RequestStatus;
  employee: { id: string; firstName: string; lastName: string; employeeCode: string };
}

export interface OvertimeRow {
  id: string;
  workDate: string;
  minutes: number;
  kind: 'REGULAR' | 'REST_DAY' | 'HOLIDAY';
  status: RequestStatus;
  employee: { id: string; firstName: string; lastName: string; employeeCode: string };
}

export interface AuditRow {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  ip: string | null;
  createdAt: string;
  metadata: unknown;
  actor: { email: string; role: string } | null;
}

export interface NamedRef {
  id: string;
  name: string;
}
