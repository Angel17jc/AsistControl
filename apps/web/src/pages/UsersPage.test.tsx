import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmployeeRow, UserRow } from '../lib/types';
import { useAuth } from '../stores/auth';
import { UsersPage } from './UsersPage';

const fetchMock = vi.fn<typeof fetch>();

const account = (over: Partial<UserRow>): UserRow => ({
  id: 'u',
  email: 'x@e.local',
  role: 'HR',
  isActive: true,
  employeeId: null,
  lastLoginAt: null,
  createdAt: '2026-09-01T00:00:00Z',
  employee: null,
  ...over,
});

const USERS: UserRow[] = [
  account({ id: 'u-me', email: 'yo@e.local', role: 'SUPER_ADMIN' }),
  account({ id: 'u-admin', email: 'admin@e.local', role: 'ADMIN' }),
  account({ id: 'u-hr', email: 'rrhh@e.local', role: 'HR' }),
  account({
    id: 'u-emp',
    email: 'ana@e.local',
    role: 'EMPLOYEE',
    employeeId: 'e1',
    employee: { id: 'e1', firstName: 'Ana', lastName: 'Ruiz', employeeCode: 'EMP-1' },
  }),
];

const employee = (id: string, name: string, user: EmployeeRow['user']) =>
  ({
    id,
    firstName: name,
    lastName: 'Prueba',
    employeeCode: id.toUpperCase(),
    user,
  }) as EmployeeRow;
const EMPLOYEES = [
  employee('e1', 'Ana', { id: 'u-emp', email: 'ana@e.local', isActive: true }),
  employee('e2', 'Luis', null),
];

function renderPage(role: 'SUPER_ADMIN' | 'ADMIN' = 'SUPER_ADMIN') {
  useAuth.setState({
    status: 'authenticated',
    accessToken: 'token',
    user: { id: 'u-me', email: 'yo@e.local', role, employeeId: null, displayName: 'Yo' },
  });
  fetchMock.mockImplementation(async (input, init) => {
    if (init?.method && init.method !== 'GET') {
      return init.method === 'POST' && String(input).endsWith('/reset-password')
        ? new Response(null, { status: 204 })
        : Response.json({ id: 'new' });
    }
    const url = String(input);
    if (url.startsWith('/api/users')) {
      return Response.json({
        data: USERS,
        meta: { page: 1, pageSize: 20, total: 4, totalPages: 1 },
      });
    }
    if (url.startsWith('/api/employees')) {
      return Response.json({
        data: EMPLOYEES,
        meta: { page: 1, pageSize: 8, total: 2, totalPages: 1 },
      });
    }
    return new Response(null, { status: 404 });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <UsersPage />
    </QueryClientProvider>,
  );
}

const sent = (method: string) => {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === method);
  return call && { url: String(call[0]), body: call[1]?.body && JSON.parse(String(call[1].body)) };
};
const rowOf = async (email: string) => (await screen.findByText(email)).closest('tr')!;

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('UsersPage', () => {
  it('lists accounts with their role, employee and state', async () => {
    renderPage();
    const ana = await rowOf('ana@e.local');
    expect(within(ana).getByText('Empleado')).toBeVisible();
    expect(within(ana).getByText('Ana Ruiz · EMP-1')).toBeVisible();
    expect(within(ana).getByText('Activa')).toBeVisible();
    expect(within(await rowOf('yo@e.local')).getByText('(usted)')).toBeVisible();
  });

  it('creates an employee account linked to a person who has none yet', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Nueva cuenta' }));
    const form = screen.getByRole('form', { name: 'Nueva cuenta' });
    await userEvent.type(within(form).getByLabelText('Correo'), 'luis@e.local');
    expect(within(form).getByLabelText('Rol')).toHaveValue('EMPLOYEE');
    const create = within(form).getByRole('button', { name: 'Crear cuenta' });

    // Ana already has an account: she cannot be picked.
    const ana = await within(form).findByRole('button', { name: /Ana Prueba/ });
    expect(ana).toBeDisabled();
    expect(within(ana).getByText('ya tiene cuenta')).toBeVisible();
    await userEvent.click(within(form).getByRole('button', { name: /Luis Prueba/ }));

    expect(create).toBeDisabled(); // no password yet
    await userEvent.click(within(form).getByRole('button', { name: 'Generar' }));
    const password = (within(form).getByLabelText('Contraseña inicial') as HTMLInputElement).value;
    expect(password).toMatch(/^(?=.*[A-Za-z])(?=.*\d).{14}$/);
    await userEvent.click(create);

    await waitFor(() =>
      expect(sent('POST')).toEqual({
        url: '/api/users',
        body: { email: 'luis@e.local', password, role: 'EMPLOYEE', employeeId: 'e2' },
      }),
    );
  });

  it('asks for an employee only when the role needs one', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Nueva cuenta' }));
    const form = screen.getByRole('form', { name: 'Nueva cuenta' });
    expect(within(form).getByText(/elija uno/)).toBeVisible();
    await userEvent.selectOptions(within(form).getByLabelText('Rol'), 'HR');
    expect(within(form).queryByText(/elija uno/)).toBeNull();
    expect(within(form).getByText('Empleado (opcional)')).toBeVisible();
  });

  it('keeps an administrator away from administrator accounts and roles', async () => {
    renderPage('ADMIN');
    expect(
      within(await rowOf('admin@e.local')).queryByRole('button', { name: /^Editar/ }),
    ).toBeNull();
    expect(
      within(await rowOf('rrhh@e.local')).getByRole('button', { name: /^Editar/ }),
    ).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Nueva cuenta' }));
    const roles = within(screen.getByRole('form', { name: 'Nueva cuenta' })).getByLabelText('Rol');
    expect(
      within(roles)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Talento humano', 'Supervisor', 'Empleado']);
  });

  it('never offers to deactivate or demote yourself', async () => {
    renderPage();
    const me = await rowOf('yo@e.local');
    expect(within(me).queryByRole('button', { name: /^Desactivar/ })).toBeNull();
    await userEvent.click(within(me).getByRole('button', { name: /^Editar/ }));
    const form = screen.getByRole('form', { name: 'Editar cuenta yo@e.local' });
    expect(within(form).getByLabelText('Rol')).toBeDisabled();
  });

  it('deactivates after confirming, since it ends their sessions', async () => {
    renderPage();
    const hr = await rowOf('rrhh@e.local');
    await userEvent.click(within(hr).getByRole('button', { name: 'Desactivar rrhh@e.local' }));
    expect(within(hr).getByText('Cierra sus sesiones.')).toBeVisible();
    await userEvent.click(within(hr).getByRole('button', { name: 'Sí, desactivar' }));
    await waitFor(() =>
      expect(sent('PATCH')).toEqual({ url: '/api/users/u-hr', body: { isActive: false } }),
    );
  });

  it('resets a password to a generated one', async () => {
    renderPage();
    const hr = await rowOf('rrhh@e.local');
    await userEvent.click(
      within(hr).getByRole('button', { name: 'Restablecer contraseña de rrhh@e.local' }),
    );
    const form = screen.getByRole('form', { name: 'Restablecer contraseña de rrhh@e.local' });
    await userEvent.click(within(form).getByRole('button', { name: 'Generar' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Restablecer' }));
    expect(await within(form).findByRole('status')).toHaveTextContent('Contraseña restablecida');
    expect(sent('POST')?.url).toBe('/api/users/u-hr/reset-password');
    expect(sent('POST')?.body.password).toHaveLength(14);
  });
});
