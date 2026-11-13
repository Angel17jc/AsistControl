import type { LeaveType, PresenceState, PunchReading } from './domain';
import type { ApiErrorCode, ApiErrorParams } from './errors';
import type { AttendanceEventCreatedPayload } from './realtime';
import type { Role } from './rbac';

export interface PaginatedResponse<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface ApiErrorResponse {
  statusCode: number;
  error: string;
  /** What happened, for clients to word (ADR 0014). */
  code: ApiErrorCode;
  /** The values of that code, see `ApiErrorParams`. */
  params?: ApiErrorParams[ApiErrorCode];
  /** In English: for logs and for whoever calls the API by hand. */
  message: string | string[];
  path: string;
  timestamp: string;
  requestId?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  employeeId: string | null;
  displayName: string;
  /**
   * An administrator chose this password (new account or reset). Until the owner picks their
   * own, the API refuses everything except changing it, reading the profile and signing out.
   */
  mustChangePassword: boolean;
}

/**
 * Returned by login and refresh. The refresh token never appears in the body:
 * it travels in an httpOnly cookie so scripts in the page cannot read it.
 */
export interface AuthSession {
  accessToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
  user: AuthUser;
}

/** Someone registered on a terminal, and who they are in AsistControl if already there. */
export interface DevicePerson {
  /** Their user number on the terminal: Employee.biometricId. */
  deviceUserId: string;
  /** As typed on the terminal (often in capitals). */
  name: string;
  /** A terminal administrator, not necessarily someone who punches. */
  admin: boolean;
  employee: { id: string; firstName: string; lastName: string; employeeCode: string } | null;
}

/** What an import from a terminal did, person by person. */
export interface ImportEmployeesResult {
  created: { biometricId: string; employeeId: string; employeeCode: string }[];
  skipped: { biometricId: string; reason: 'ALREADY_REGISTERED' | 'CODE_IN_USE' }[];
}

/** What the sign-in page may offer, before anyone is signed in. */
export interface AuthOptions {
  /** "Olvidé mi contraseña" and invitations work: the server can send (or show) the email. */
  passwordLinks: boolean;
}

/** Why a password link was sent (ADR 0016). */
export const PASSWORD_LINK_PURPOSES = ['RESET', 'INVITE'] as const;
export type PasswordLinkPurpose = (typeof PASSWORD_LINK_PURPOSES)[number];

/** What a valid password link opens: whose password it sets, and until when. */
export interface PasswordLinkInfo {
  email: string;
  purpose: PasswordLinkPurpose;
  expiresAt: string;
}

export interface DashboardSummary {
  date: string;
  timezone: string;
  employees: { active: number; scheduledToday: number };
  attendance: {
    present: number;
    late: number;
    absent: number;
    onLeave: number;
    pendingArrival: number;
  };
  overtimeMinutesMonth: number;
  pendingRequests: { leave: number; overtime: number };
  devices: { total: number; online: number; offline: number; error: number };
  hourlyPunches: { hour: number; count: number }[];
  latestEvents: AttendanceEventCreatedPayload[];
}

/** A person on the presence board: where they are now and since when. */
export interface PresenceEntry {
  employee: {
    id: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
    department: string | null;
  };
  state: PresenceState;
  /** The work day "now" belongs to: yesterday's during a night shift that crosses midnight. */
  workDate: string;
  shift: {
    /** No fixed hours: `start` and `end` only measure how long the day is expected to be. */
    flexible: boolean;
    start: string;
    end: string;
    breakStart: string | null;
    breakEnd: string | null;
  } | null;
  /** When the person is expected, moved by approved leave (e.g. a morning permission). */
  expectedStart: string | null;
  expectedEnd: string | null;
  firstIn: string | null;
  lateMinutes: number;
  lastPunch: { at: string; reading: PunchReading; deviceName: string | null } | null;
  /** The approved leave covering this moment, if any. */
  leaveType: LeaveType | null;
}

/** GET /settings/features: what any signed-in person's screens depend on. */
export interface CompanyFeatures {
  overtimeEnabled: boolean;
}

/** GET /attendance/presence */
export interface PresenceBoard {
  at: string;
  timezone: string;
  counts: Record<PresenceState, number>;
  entries: PresenceEntry[];
}
