import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogRow } from '../lib/types';
import { useAuth } from '../stores/auth';
import { OrganizationPage } from './OrganizationPage';

const fetchMock = vi.fn<typeof fetch>();

const DEPARTMENTS: CatalogRow[] = [
  { id: 'd1', code: 'OPS', name: 'Operaciones', description: null, _count: { employees: 4 } },
  { id: 'd2', code: 'MKT', name: 'Marketing', description: 'Campañas', _count: { employees: 0 } },
];
const POSITIONS: CatalogRow[] = [
  { id: 'p1', name: 'Analista', description: null, _count: { employees: 0 } },
];

function renderPage(
  role: 'HR' | 'ADMIN' = 'HR',
  write: (url: string, init: RequestInit) => Response = () => Response.json({ id: 'new' }),
) {
  useAuth.setState({
    status: 'authenticated',
    accessToken: 'token',
    user: { id: 'u1', email: 'rrhh@e.local', role, employeeId: null, displayName: 'RRHH' },
  });
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method && init.method !== 'GET') return write(url, init);
    if (url === '/api/departments') return Response.json(DEPARTMENTS);
    if (url === '/api/positions') return Response.json(POSITIONS);
    return new Response(null, { status: 404 });
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <OrganizationPage />
    </QueryClientProvider>,
  );
}

const section = (title: string) => screen.getByRole('heading', { name: title }).closest('section')!;
const sent = (method: string) => {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === method);
  return call && { url: String(call[0]), body: call[1]?.body && JSON.parse(String(call[1].body)) };
};

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('OrganizationPage', () => {
  it('lists departments with their code and head count, and positions', async () => {
    renderPage();
    const ops = (await screen.findByText('Operaciones')).closest('tr')!;
    expect(within(ops).getByText('OPS')).toBeVisible();
    expect(within(ops).getByText('4')).toBeVisible();
    expect(within(section('Cargos')).getByText('Analista')).toBeVisible();
    expect(within(section('Cargos')).queryByText('Código')).toBeNull();
  });

  it('offers to delete only what nobody belongs to', async () => {
    renderPage();
    await screen.findByText('Operaciones');
    expect(screen.queryByRole('button', { name: 'Eliminar Operaciones' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar Marketing' }));
    await waitFor(() => expect(sent('DELETE')?.url).toBe('/api/departments/d2'));
  });

  it('creates a department', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo departamento' }));
    const form = screen.getByRole('form', { name: 'Nuevo departamento' });
    await userEvent.type(within(form).getByLabelText('Código'), 'LOG');
    await userEvent.type(within(form).getByLabelText('Nombre'), 'Logística');
    await userEvent.click(within(form).getByRole('button', { name: 'Crear' }));
    await waitFor(() =>
      expect(sent('POST')).toEqual({
        url: '/api/departments',
        body: { code: 'LOG', name: 'Logística', description: null },
      }),
    );
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
  });

  it('edits a department and clears its description', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Marketing' }));
    const form = screen.getByRole('form', { name: 'Editar Marketing' });
    await userEvent.clear(within(form).getByLabelText('Descripción (opcional)'));
    await userEvent.click(within(form).getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() =>
      expect(sent('PATCH')).toEqual({
        url: '/api/departments/d2',
        body: { code: 'MKT', name: 'Marketing', description: null },
      }),
    );
  });

  it('explains a duplicate name in plain words', async () => {
    renderPage('HR', () =>
      Response.json(
        { statusCode: 409, message: 'A record with the same name already exists' },
        { status: 409 },
      ),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo cargo' }));
    const form = screen.getByRole('form', { name: 'Nuevo cargo' });
    await userEvent.type(within(form).getByLabelText('Nombre'), 'Analista');
    await userEvent.click(within(form).getByRole('button', { name: 'Crear' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'Ya existe un cargo con ese nombre.',
    );
    expect(sent('POST')?.body).toEqual({ name: 'Analista', description: null });
  });
});
