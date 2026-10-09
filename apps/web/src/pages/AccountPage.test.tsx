import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../stores/auth';
import { AccountPage } from './AccountPage';

const fetchMock = vi.fn<typeof fetch>();
const CURRENT = 'Clave-Actual-2026';
const NEXT = 'Clave-Nueva-2026';

function renderPage(answer: Response = new Response(null, { status: 204 })) {
  useAuth.setState({
    status: 'authenticated',
    accessToken: 'token',
    user: {
      id: 'u1',
      email: 'ana@e.local',
      role: 'EMPLOYEE',
      employeeId: 'e1',
      displayName: 'Ana Ruiz',
    },
  });
  fetchMock.mockResolvedValue(answer);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AccountPage />
    </QueryClientProvider>,
  );
  const form = screen.getByRole('form', { name: 'Cambiar contraseña' });
  return {
    form,
    submit: within(form).getByRole('button', { name: 'Cambiar contraseña' }),
    fill: async (current: string, next: string, repeat = next) => {
      await userEvent.type(within(form).getByLabelText('Contraseña actual'), current);
      await userEvent.type(within(form).getByLabelText('Nueva contraseña'), next);
      await userEvent.type(within(form).getByLabelText('Repita la nueva contraseña'), repeat);
    },
  };
}

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('AccountPage', () => {
  it('shows who is signed in', () => {
    renderPage();
    expect(screen.getByText('Ana Ruiz')).toBeVisible();
    expect(screen.getByText('ana@e.local')).toBeVisible();
    expect(screen.getByText('Empleado')).toBeVisible();
  });

  it('changes the password and clears the form', async () => {
    const { form, submit, fill } = renderPage();
    expect(submit).toBeDisabled();
    await fill(CURRENT, NEXT);
    await userEvent.click(submit);

    expect(await within(form).findByRole('status')).toHaveTextContent('Contraseña cambiada');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/auth/change-password');
    expect(JSON.parse(String(init!.body))).toEqual({
      currentPassword: CURRENT,
      newPassword: NEXT,
    });
    expect(within(form).getByLabelText('Contraseña actual')).toHaveValue('');
  });

  it('says what is wrong before submitting', async () => {
    const { form, submit, fill } = renderPage();
    await fill(CURRENT, NEXT, 'Clave-Otra-2026');
    expect(within(form).getByRole('alert')).toHaveTextContent('no coinciden');
    expect(submit).toBeDisabled();

    await userEvent.clear(within(form).getByLabelText('Nueva contraseña'));
    await userEvent.type(within(form).getByLabelText('Nueva contraseña'), CURRENT);
    expect(within(form).getByRole('alert')).toHaveTextContent('distinta de la actual');
    expect(submit).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explains a wrong current password without signing out', async () => {
    const { form, submit, fill } = renderPage(
      Response.json({ statusCode: 403, message: 'Current password is incorrect' }, { status: 403 }),
    );
    await fill('Clave-Errada-2026', NEXT);
    await userEvent.click(submit);
    await waitFor(() =>
      expect(within(form).getByRole('alert')).toHaveTextContent(
        'La contraseña actual no es correcta.',
      ),
    );
    expect(useAuth.getState().status).toBe('authenticated');
  });

  it('can show the passwords while typing', async () => {
    const { form } = renderPage();
    const field = within(form).getByLabelText('Nueva contraseña');
    expect(field).toHaveAttribute('type', 'password');
    await userEvent.click(within(form).getByLabelText('Mostrar contraseñas'));
    expect(field).toHaveAttribute('type', 'text');
  });
});
