import type { ApiErrorResponse, AuthSession } from '@asistcontrol/shared';
import { useAuth } from '../stores/auth';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorResponse | null,
  ) {
    const message = body?.message;
    super(Array.isArray(message) ? message.join('. ') : (message ?? `Error ${status}`));
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Exchanges the httpOnly refresh cookie for a new access token.
 * Single-flight: concurrent 401s share one refresh, because the server rotates the token
 * and treats a second use of the old one as theft.
 */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) {
        useAuth.getState().clear();
        return false;
      }
      useAuth.getState().setSession((await res.json()) as AuthSession);
      return true;
    } catch {
      useAuth.getState().clear();
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export function buildUrl(path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return `/api${path}${qs ? `?${qs}` : ''}`;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const token = useAuth.getState().accessToken;
  return fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

async function withAuthRetry(path: string, options: RequestOptions): Promise<Response> {
  let res = await send(path, options);
  if (res.status === 401 && !path.startsWith('/auth/')) {
    if (await refreshSession()) res = await send(path, options);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorResponse | null;
    throw new ApiError(res.status, body);
  }
  return res;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await withAuthRetry(path, options);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Authenticated file download (CSV reports). */
export async function download(path: string, query: Query, fallbackName: string): Promise<void> {
  const res = await withAuthRetry(path, { query });
  const disposition = res.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

export async function login(email: string, password: string): Promise<void> {
  const session = await api<AuthSession>('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  useAuth.getState().setSession(session);
}

export async function logout(): Promise<void> {
  try {
    await api('/auth/logout', { method: 'POST' });
  } finally {
    useAuth.getState().clear();
  }
}
