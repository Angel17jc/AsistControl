import type { Role } from '@asistcontrol/shared';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  email: string;
  role: Role;
  eid: string | null;
  typ: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  sid: string;
  typ: 'refresh';
}
