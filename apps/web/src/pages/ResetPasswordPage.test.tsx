import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResetPasswordPage } from './ResetPasswordPage';

const fetchMock = vi.fn<typeof fetch>();
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';
const INFO = { email: 'melanie@empresa.com', purpose: 'RESET', expiresAt: '2026-11-12T20:30:00Z' };

/** Shows where "Iniciar sesión" leads, and with what. */
function LoginProbe() {
  const state = useLocation().state as { email?: string } | null;
  return <p>Login con {state?.email}</p>;
}

function renderPage({
  hash = `#${TOKEN}`,
  link = Response.json(INFO) as Response,
  reset = new Response(null, { status: 204 }) as Response,
} = {}) {
  window.history.replaceState(null, '', `/restablecer${hash}`);
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith('/api/auth/password-link')) return link.clone();
    if (url.startsWith('/api/auth/reset-password')) return reset;
    return new Response(null, { status: 404 });
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/restablecer']}>
        <Routes>
          <Route path="/restablecer" element={<ResetPasswordPage />} />
          <Route path="/login" element={<LoginProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const calls = (path: string) =>
  fetchMock.mock.calls.filter(([input]) => String(input).startsWith(`/api${path}`));

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('ResetPasswordPage', () => {
  it('says whose password it sets and hides the token from the address bar', async () => {
    renderPage();
    expect(
      await screen.findByRole('heading', { name: 'Elija una contraseña nueva' }),
    ).toBeVisible();
    expect(screen.getByText('melanie@empresa.com')).toBeVisible();
    expect(window.location.hash).toBe('');
    const [, init] = calls('/auth/password-link')[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ token: TOKEN });
  });

  it('asks for a strong password, twice the same, before sending', async () => {
    renderPage();
    const password = await screen.findByLabelText('Contraseña nueva');
    await userEvent.type(password, 'corta');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
    expect(password).toHaveAccessibleDescription('Al menos 10 caracteres, con letras y números.');

    await userEvent.clear(password);
    await userEvent.type(password, 'Melanie2026Propia');
    await userEvent.type(screen.getByLabelText('Repita la contraseña'), 'Melanie2026Otra');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
    expect(screen.getByLabelText('Repita la contraseña')).toHaveAccessibleDescription(
      'Las dos contraseñas no coinciden.',
    );
    expect(calls('/auth/reset-password')).toHaveLength(0);
  });

  it('saves it and sends the person to sign in with the address filled in', async () => {
    renderPage();
    await userEvent.type(await screen.findByLabelText('Contraseña nueva'), 'Melanie2026Propia');
    await userEvent.type(screen.getByLabelText('Repita la contraseña'), 'Melanie2026Propia');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Ya puede entrar con su nueva contraseña',
    );
    const [, init] = calls('/auth/reset-password')[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({
      token: TOKEN,
      newPassword: 'Melanie2026Propia',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    expect(screen.getByText('Login con melanie@empresa.com')).toBeVisible();
  });

  it('words an invitation as the first password of the account', async () => {
    renderPage({ link: Response.json({ ...INFO, purpose: 'INVITE' }) });
    expect(await screen.findByRole('heading', { name: 'Elija su contraseña' })).toBeVisible();
  });

  it('explains an expired link and offers a new one', async () => {
    renderPage({
      link: Response.json(
        { statusCode: 400, code: 'PASSWORD_LINK_EXPIRED', params: { purpose: 'RESET' } },
        { status: 400 },
      ),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Este enlace venció');
    expect(screen.getByRole('link', { name: 'Pedir un enlace nuevo' })).toBeVisible();
  });

  it('sends an expired invitation back to an administrator', async () => {
    renderPage({
      link: Response.json(
        { statusCode: 400, code: 'PASSWORD_LINK_EXPIRED', params: { purpose: 'INVITE' } },
        { status: 400 },
      ),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Pida a un administrador');
    expect(screen.queryByRole('link', { name: 'Pedir un enlace nuevo' })).toBeNull();
  });

  it('says the link is incomplete when it has no token', () => {
    renderPage({ hash: '' });
    expect(screen.getByRole('heading', { name: 'Enlace incompleto' })).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
