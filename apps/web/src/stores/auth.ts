import {
  type AuthSession,
  type AuthUser,
  type Permission,
  hasPermission,
} from '@asistcontrol/shared';
import { create } from 'zustand';

/**
 * Session state shared by the router, the API client and the socket.
 * Zustand is used here (and only here) because the API client must read the token
 * outside React. The access token lives in memory only — never in localStorage —
 * and is restored on reload through the httpOnly refresh cookie.
 */
interface AuthState {
  status: 'unknown' | 'authenticated' | 'anonymous';
  user: AuthUser | null;
  accessToken: string | null;
  setSession: (session: AuthSession) => void;
  clear: () => void;
  can: (permission: Permission) => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'unknown',
  user: null,
  accessToken: null,
  setSession: (session) =>
    set({ status: 'authenticated', user: session.user, accessToken: session.accessToken }),
  clear: () => set({ status: 'anonymous', user: null, accessToken: null }),
  can: (permission) => {
    const user = get().user;
    return user ? hasPermission(user.role, permission) : false;
  },
}));
