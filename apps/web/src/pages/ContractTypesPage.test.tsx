import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractTypeRow } from '../lib/types';
import { useAuth } from '../stores/auth';
import { ContractTypesPage } from './ContractTypesPage';

const fetchMock = vi.fn<typeof fetch>();

const TYPES: ContractTypeRow[] = [
  {
    id: 'ct1',
    name: 'Tiempo completo',
    vacationDaysPerYear: 15,
    vacationAccrual: 'ANNUAL',
    vacationDayCounting: 'WORKING_DAYS',
    seniority: { afterYears: 5, extraDaysPerYear: 1, maxExtraDays: 15 },
    vacationExpiryMonths: 24,
    allowNegativeVacationBalance: false,
    employees: 9,
  },
  {
    id: 'ct2',
    name: 'Temporal',
    vacationDaysPerYear: 7.5,
    vacationAccrual: 'MONTHLY',
    vacationDayCounting: 'CALENDAR_DAYS',
    seniority: null,
    vacationExpiryMonths: null,
    allowNegativeVacationBalance: true,
    employees: 0,
  },
];

function renderPage(role: 'HR' | 'SUPERVISOR' = 'HR') {
  useAuth.setState({
    status: 'authenticated',
    accessToken: 'token',
    user: { id: 'u1', email: 'hr@e.local', role, employeeId: null, displayName: 'RRHH' },
  });
  fetchMock.mockImplementation(async (_input, init) =>
    init?.method && init.method !== 'GET' ? Response.json({ id: 'new' }) : Response.json(TYPES),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ContractTypesPage />
    </QueryClientProvider>,
  );
}

const sent = (method: string) => {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === method);
  return call && { url: String(call[0]), body: call[1]?.body && JSON.parse(String(call[1].body)) };
};

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('ContractTypesPage', () => {
  it('lists each contract type with its rules in words', async () => {
    renderPage();
    const row = (await screen.findByText('Tiempo completo')).closest('tr')!;
    expect(within(row).getByText('15 días')).toBeVisible();
    expect(within(row).getByText('Anual, en cada aniversario')).toBeVisible();
    expect(within(row).getByText('+1 día/año desde el año 6, máx. 15 días')).toBeVisible();
    expect(within(row).getByText('24 meses después de cada aniversario')).toBeVisible();

    const temporal = screen.getByText('Temporal').closest('tr')!;
    expect(within(temporal).getByText('7,5 días')).toBeVisible();
    expect(within(temporal).getByText('Días corridos')).toBeVisible();
    expect(within(temporal).getByText('No caducan')).toBeVisible();
  });

  it('only offers to delete the types nobody uses', async () => {
    renderPage();
    await screen.findByText('Tiempo completo');
    expect(screen.queryByRole('button', { name: 'Eliminar Tiempo completo' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar Temporal' }));
    await waitFor(() => expect(sent('DELETE')?.url).toBe('/api/contract-types/ct2'));
  });

  it('creates one, with a seniority bonus only when asked for', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo tipo de contrato' }));
    const form = screen.getByRole('form', { name: 'Nuevo tipo de contrato' });
    await userEvent.type(within(form).getByLabelText('Nombre'), 'Pasantía');
    await userEvent.clear(within(form).getByLabelText('Días de vacaciones por año'));
    await userEvent.type(within(form).getByLabelText('Días de vacaciones por año'), '10');
    await userEvent.type(
      within(form).getByLabelText('Los días no usados caducan a los (meses)'),
      '12',
    );
    expect(within(form).queryByLabelText('Máximo de días extra')).toBeNull();

    await userEvent.click(within(form).getByLabelText('Días extra por antigüedad'));
    await userEvent.clear(within(form).getByLabelText('Máximo de días extra'));
    await userEvent.type(within(form).getByLabelText('Máximo de días extra'), '5');
    await userEvent.click(within(form).getByRole('button', { name: 'Crear' }));

    await waitFor(() =>
      expect(sent('POST')).toEqual({
        url: '/api/contract-types',
        body: {
          name: 'Pasantía',
          vacationDaysPerYear: 10,
          vacationAccrual: 'ANNUAL',
          vacationDayCounting: 'WORKING_DAYS',
          allowNegativeVacationBalance: false,
          vacationExpiryMonths: 12,
          seniority: { afterYears: 5, extraDaysPerYear: 1, maxExtraDays: 5 },
        },
      }),
    );
  });

  it('edits one, and can drop its seniority bonus', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Tiempo completo' }));
    const form = screen.getByRole('form', { name: 'Editar Tiempo completo' });
    expect(within(form).getByLabelText('Nombre')).toHaveValue('Tiempo completo');
    await userEvent.click(within(form).getByLabelText('Días extra por antigüedad'));
    // Emptying the expiry means the days no longer expire.
    const expiry = within(form).getByLabelText('Los días no usados caducan a los (meses)');
    expect(expiry).toHaveValue(24);
    await userEvent.clear(expiry);
    await userEvent.click(within(form).getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(sent('PATCH')?.url).toBe('/api/contract-types/ct1'));
    expect(sent('PATCH')?.body).toMatchObject({ seniority: null, vacationExpiryMonths: null });
  });

  it('is read-only without organization:write', async () => {
    renderPage('SUPERVISOR');
    await screen.findByText('Tiempo completo');
    expect(screen.queryByRole('button', { name: 'Nuevo tipo de contrato' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Editar/ })).toBeNull();
  });
});
