import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { useAuth } from '../stores/auth';
import { PasswordChangeRequiredPage } from './PasswordChangeRequiredPage';

const fetchMock = vi.fn<typeof fetch>();
const GIVEN = 'Clave-Dada-2026';
const OWN = 'Clave-Propia-2026';

const user = (mustChangePassword: boolean) => ({
  id: 'u1',
  email: 'ana@e.local',
  role: 'HR' as const,
  employeeId: null,
  displayName: 'Ana Ruiz',
  mustChangePassword,
});

function signedIn(mustChangePassword = true) {
  useAuth.setState({
    status: 'authenticated',
    accessToken: 'token',
    user: user(mustChangePassword),
  });
}

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={['/empleados']}>{ui}</MemoryRouter>
  </QueryClientProvider>
);

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('PasswordChangeRequiredPage', () => {
  it('stands in front of every page while the password is an administrator’s', () => {
    signedIn();
    render(wrap(<App />));
    expect(screen.getByRole('heading', { name: 'Elija su contraseña' })).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'Principal' })).toBeNull();
  });

  it('replaces the password and renews the session without the mark', async () => {
    signedIn();
    fetchMock.mockImplementation(async (input) =>
      String(input) === '/api/auth/refresh'
        ? Response.json({ accessToken: 'clean', expiresIn: 900, user: user(false) })
        : new Response(null, { status: 204 }),
    );
    render(wrap(<PasswordChangeRequiredPage />));

    const form = screen.getByRole('form', { name: 'Cambiar contraseña' });
    await userEvent.type(within(form).getByLabelText('Contraseña actual'), GIVEN);
    await userEvent.type(within(form).getByLabelText('Nueva contraseña'), OWN);
    await userEvent.type(within(form).getByLabelText('Repita la nueva contraseña'), OWN);
    await userEvent.click(within(form).getByRole('button', { name: 'Cambiar contraseña' }));

    await waitFor(() => expect(useAuth.getState().user?.mustChangePassword).toBe(false));
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/auth/change-password',
      '/api/auth/refresh',
    ]);
    expect(useAuth.getState().accessToken).toBe('clean');
  });

  it('lets the person sign out instead', async () => {
    signedIn();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    render(wrap(<PasswordChangeRequiredPage />));
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    await waitFor(() => expect(useAuth.getState().status).toBe('anonymous'));
    expect(String(fetchMock.mock.calls[0]![0])).toBe('/api/auth/logout');
  });
});
