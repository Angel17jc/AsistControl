import type { Role } from '@asistcontrol/shared';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  email: string;
  role: Role;
  eid: string | null;
  /** Present only while the password must be changed (see AuthUser.mustChangePassword). */
  pwc?: true;
  typ: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  sid: string;
  typ: 'refresh';
}
