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
  const fetchMock = vi.fn<typeof fetch>();

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

  it('says what is missing instead of asking the server', async () => {
    renderPage();
    await submit();
    expect(emailField()).toHaveAccessibleDescription('Escriba su correo.');
    expect(emailField()).toHaveAttribute('aria-invalid', 'true');
    expect(passwordField()).toHaveAccessibleDescription('Escriba su contraseña.');
    expect(emailField()).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('points at a mistyped email, and stops once it is fixed', async () => {
    renderPage();
    await userEvent.type(emailField(), 'admin@empresa');
    await userEvent.type(passwordField(), 'secreto');
    await submit();
    expect(emailField()).toHaveAccessibleDescription(
      'Revise el correo: debe tener la forma nombre@empresa.com.',
    );
    expect(fetchMock).not.toHaveBeenCalled();

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
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
        { status: 401 },
      ),
    );
    renderPage();
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
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(SESSION), { status: 200 }));
    renderPage();
    await userEvent.type(emailField(), '  a@b.co ');
    await userEvent.type(passwordField(), 'pw');
    await submit();
    await vi.waitFor(() => expect(useAuth.getState().status).toBe('authenticated'));
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ email: 'a@b.co', password: 'pw' });
    expect(useAuth.getState().accessToken).toBe('tok');
    expect(setItem).not.toHaveBeenCalled();
  });
});
