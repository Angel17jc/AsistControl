import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../stores/auth';
import { LoginPage } from './LoginPage';

const fetchMock = vi.fn<typeof fetch>();

/**
 * The page asks the server what it may offer as soon as it opens: answer by address, so the
 * sign-in request gets its own answer whatever the order.
 */
function renderPage({
  passwordLinks = false,
  login = new Response(null, { status: 500 }) as Response,
  state = undefined as { email: string } | undefined,
} = {}) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith('/api/auth/options')) return Response.json({ passwordLinks });
    if (url.startsWith('/api/auth/login')) return login;
    return new Response(null, { status: 404 });
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[{ pathname: '/login', state }]}>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const loginCalls = () =>
  fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/auth/login'));

const emailField = () => screen.getByLabelText('Correo electrónico');
const passwordField = () => screen.getByLabelText('Contraseña');
const submit = () => userEvent.click(screen.getByRole('button', { name: 'Ingresar' }));

const SESSION = {
  accessToken: 'tok',
  expiresIn: 900,
  user: {
    id: '1',
    email: 'a@b.co',
    role: 'ADMIN',
    employeeId: null,
    displayName: 'Admin',
    mustChangePassword: false,
  },
};

describe('LoginPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    useAuth.setState({ status: 'anonymous', user: null, accessToken: null });
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('presents AsistControl under the Kairosig brand', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'AsistControl', level: 1 })).toBeInTheDocument();
    // One logo per theme; the stylesheet shows the one that matches.
    const logos = screen.getAllByRole('img', { name: 'Kairosig' });
    expect(logos.map((img) => img.className)).toEqual([
      expect.stringContaining('brand-logo-light'),
      expect.stringContaining('brand-logo-dark'),
    ]);
  });

  it('starts in the email field and says how to recover a forgotten password', () => {
    renderPage();
    expect(emailField()).toHaveFocus();
    expect(screen.getByText(/Pida a un administrador que se la restablezca/)).toBeVisible();
  });

  it('offers "olvidé mi contraseña" when the server can email the link', async () => {
    renderPage({ passwordLinks: true });
    expect(await screen.findByRole('link', { name: '¿Olvidó su contraseña?' })).toHaveAttribute(
      'href',
      '/olvide-contrasena',
    );
    expect(screen.queryByText(/Pida a un administrador/)).toBeNull();
  });

  it('comes back from choosing a password with the address filled in', () => {
    renderPage({ state: { email: 'melanie@empresa.com' } });
    expect(emailField()).toHaveValue('melanie@empresa.com');
    expect(passwordField()).toHaveFocus();
  });

  it('says what is missing instead of asking the server', async () => {
    renderPage();
    await submit();
    expect(emailField()).toHaveAccessibleDescription('Escriba su correo.');
    expect(emailField()).toHaveAttribute('aria-invalid', 'true');
    expect(passwordField()).toHaveAccessibleDescription('Escriba su contraseña.');
    expect(emailField()).toHaveFocus();
    expect(loginCalls()).toHaveLength(0);
  });

  it('points at a mistyped email, and stops once it is fixed', async () => {
    renderPage();
    await userEvent.type(emailField(), 'admin@empresa');
    await userEvent.type(passwordField(), 'secreto');
    await submit();
    expect(emailField()).toHaveAccessibleDescription(
      'Revise el correo: debe tener la forma nombre@empresa.com.',
    );
    expect(loginCalls()).toHaveLength(0);

    await userEvent.type(emailField(), '.com');
    expect(emailField()).not.toHaveAttribute('aria-invalid');
    expect(emailField()).not.toHaveAccessibleDescription();
  });

  it('shows the password on request', async () => {
    renderPage();
    await userEvent.type(passwordField(), 'secreto');
    const eye = screen.getByRole('button', { name: 'Mostrar contraseña' });
    expect(passwordField()).toHaveAttribute('type', 'password');
    expect(eye).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(eye);
    expect(passwordField()).toHaveAttribute('type', 'text');
    expect(passwordField()).toHaveValue('secreto');
    expect(eye).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(eye);
    expect(passwordField()).toHaveAttribute('type', 'password');
  });

  it('warns while Caps Lock is on', async () => {
    // One keyboard session: the Caps Lock state only carries over within the same instance.
    const user = userEvent.setup();
    renderPage();
    await user.click(passwordField());
    await user.keyboard('{CapsLock}a');
    expect(screen.getByRole('status')).toHaveTextContent('Bloq Mayús está activado.');
    await user.keyboard('{CapsLock}a');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('on wrong credentials, explains and gets the password ready to retype', async () => {
    renderPage({
      login: Response.json(
        { statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
        { status: 401 },
      ),
    });
    await userEvent.type(emailField(), 'admin@asistcontrol.local');
    await userEvent.type(passwordField(), 'wrong');
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos.');
    expect(useAuth.getState().status).toBe('anonymous');
    expect(passwordField()).toHaveFocus();

    // Typing again clears the message: it is about the previous attempt.
    await userEvent.keyboard('otra');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sends the email without surrounding spaces and keeps the session in memory only', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    renderPage({ login: new Response(JSON.stringify(SESSION), { status: 200 }) });
    await userEvent.type(emailField(), '  a@b.co ');
    await userEvent.type(passwordField(), 'pw');
    await submit();
    await vi.waitFor(() => expect(useAuth.getState().status).toBe('authenticated'));
    const [, init] = loginCalls()[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ email: 'a@b.co', password: 'pw' });
    expect(useAuth.getState().accessToken).toBe('tok');
    expect(setItem).not.toHaveBeenCalled();
  });
});
