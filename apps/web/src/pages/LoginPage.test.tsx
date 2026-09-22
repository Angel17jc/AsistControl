import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../stores/auth';
import { LoginPage } from './LoginPage';

const renderPage = () =>
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );

describe('LoginPage', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    useAuth.setState({ status: 'anonymous', user: null, accessToken: null });
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('keeps the submit button disabled until both fields are filled', async () => {
    renderPage();
    const submit = screen.getByRole('button', { name: 'Ingresar' });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'admin@asistcontrol.local');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'secret');
    expect(submit).toBeEnabled();
  });

  it('shows the API error on invalid credentials', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ statusCode: 401, message: 'Invalid email or password' }), {
        status: 401,
      }),
    );
    renderPage();
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'admin@asistcontrol.local');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(useAuth.getState().status).toBe('anonymous');
  });

  it('stores the session on success (access token in memory only)', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          accessToken: 'tok',
          expiresIn: 900,
          user: { id: '1', email: 'a@b.c', role: 'ADMIN', employeeId: null, displayName: 'Admin' },
        }),
        { status: 200 },
      ),
    );
    renderPage();
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'a@b.c');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
    await vi.waitFor(() => expect(useAuth.getState().status).toBe('authenticated'));
    expect(useAuth.getState().accessToken).toBe('tok');
    expect(setItem).not.toHaveBeenCalled();
  });
});
