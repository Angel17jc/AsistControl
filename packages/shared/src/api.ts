import type { AttendanceEventCreatedPayload } from './realtime';
import type { Role } from './rbac';

export interface PaginatedResponse<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface ApiErrorResponse {
  statusCode: number;
  error: string;
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
