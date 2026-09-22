import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../stores/auth';
import { ApiError, api, buildUrl, refreshSession } from './api';

const session = {
  accessToken: 'new-token',
  expiresIn: 900,
  user: { id: 'u1', email: 'a@b.c', role: 'HR' as const, employeeId: null, displayName: 'HR' },
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

  it('exposes validation messages from the error contract', async () => {
    fetchMock.mockResolvedValueOnce(
      json(400, { statusCode: 400, message: ['a is required', 'b is invalid'] }),
    );
    await expect(api('/x', { method: 'POST', body: {} })).rejects.toThrow(
      'a is required. b is invalid',
    );
  });

  it('omits empty query parameters', () => {
    expect(
      buildUrl('/reports/daily', { from: '2026-09-01', to: undefined, search: '', page: 2 }),
    ).toBe('/api/reports/daily?from=2026-09-01&page=2');
  });
});
