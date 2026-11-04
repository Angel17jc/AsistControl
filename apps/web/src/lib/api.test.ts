import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../stores/auth';
import { ApiError, NetworkError, api, buildUrl, login, logout, refreshSession } from './api';

const session = {
  accessToken: 'new-token',
  expiresIn: 900,
  user: {
    id: 'u1',
    email: 'a@b.c',
    role: 'HR' as const,
    employeeId: null,
    displayName: 'HR',
    mustChangePassword: false,
  },
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('api client', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    useAuth.setState({ status: 'authenticated', accessToken: 'old-token', user: session.user });
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('sends the bearer token and parses JSON', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    await expect(api('/employees')).resolves.toEqual({ ok: true });
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer old-token');
  });

  it('refreshes once on 401 and retries the request with the new token', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { message: 'expired' }))
      .mockResolvedValueOnce(json(200, session))
      .mockResolvedValueOnce(json(200, { data: [] }));
    await expect(api('/employees')).resolves.toEqual({ data: [] });
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/auth/refresh');
    expect((fetchMock.mock.calls[2]![1]!.headers as Record<string, string>).Authorization).toBe(
      'Bearer new-token',
    );
  });

  it('shares a single refresh between concurrent callers (the server rotates tokens)', async () => {
    fetchMock.mockImplementation(async () => json(200, session));
    await Promise.all([refreshSession(), refreshSession(), refreshSession()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clears the session when the refresh fails', async () => {
    fetchMock.mockResolvedValueOnce(json(401, {})).mockResolvedValueOnce(json(401, {}));
    await expect(api('/employees')).rejects.toBeInstanceOf(ApiError);
    expect(useAuth.getState().status).toBe('anonymous');
  });

  it.each([
    ['the rate limit', () => json(429, {})],
    ['an API restarting behind nginx', () => json(502, {})],
  ])('keeps the session through %s and recovers on the next request', async (_, failure) => {
    fetchMock.mockResolvedValueOnce(json(401, {})).mockResolvedValueOnce(failure());
    await expect(api('/employees')).rejects.toMatchObject({ status: 401 });
    expect(useAuth.getState().status).toBe('authenticated');

    fetchMock
      .mockResolvedValueOnce(json(401, {}))
      .mockResolvedValueOnce(json(200, session))
      .mockResolvedValueOnce(json(200, { data: [] }));
    await expect(api('/employees')).resolves.toEqual({ data: [] });
    expect(useAuth.getState().accessToken).toBe('new-token');
  });

  it('keeps the session when the network is down', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(refreshSession()).resolves.toBe(false);
    expect(useAuth.getState().status).toBe('authenticated');
  });

  it('does not leave a loading page waiting when it cannot restore the session', async () => {
    useAuth.setState({ status: 'unknown', accessToken: null, user: null });
    fetchMock.mockResolvedValueOnce(json(503, {}));
    await refreshSession();
    expect(useAuth.getState().status).toBe('anonymous');
  });

  it('signs out on the server even after the access token expired', async () => {
    // Otherwise the refresh cookie survives and reloading the page signs the user back in.
    fetchMock
      .mockResolvedValueOnce(json(401, { message: 'expired' }))
      .mockResolvedValueOnce(json(200, session))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await logout();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/auth/logout',
      '/api/auth/refresh',
      '/api/auth/logout',
    ]);
    expect((fetchMock.mock.calls[2]![1]!.headers as Record<string, string>).Authorization).toBe(
      'Bearer new-token',
    );
    expect(useAuth.getState().status).toBe('anonymous');
  });

  it('does not refresh when a login is rejected: the credentials are wrong', async () => {
    fetchMock.mockResolvedValueOnce(
      json(401, { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' }),
    );
    await expect(login('a@b.c', 'nope')).rejects.toThrow('Correo o contraseña incorrectos.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows every error in words a person can read, never the English message', async () => {
    fetchMock.mockResolvedValueOnce(
      json(400, {
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        params: { violations: [{ field: 'email', rule: 'isEmail' }] },
        message: ['email must be an email'],
      }),
    );
    await expect(api('/x', { method: 'POST', body: {} })).rejects.toThrow(
      'Correo: no es un correo válido.',
    );
  });

  it('explains a page from the proxy, which is not even JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>Bad Gateway</html>', { status: 502 }));
    await expect(api('/x')).rejects.toThrow('El servidor no está disponible');
  });

  it('explains a request that never got an answer', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const failure = api('/x');
    await expect(failure).rejects.toBeInstanceOf(NetworkError);
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(api('/x')).rejects.toThrow('No se pudo conectar con el servidor');
  });

  it('omits empty query parameters', () => {
    expect(
      buildUrl('/reports/daily', { from: '2026-09-01', to: undefined, search: '', page: 2 }),
    ).toBe('/api/reports/daily?from=2026-09-01&page=2');
  });
});
