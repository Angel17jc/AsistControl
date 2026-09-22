import type { Role } from '@asistcontrol/shared';

/** Identity attached to the request by JwtAuthGuard. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  employeeId: string | null;
  sessionId: string;
}

/** Network context recorded in audit logs. */
export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}
