import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDays } from '../../lib/format';
import type { VacationBalance } from '../../lib/types';
import { useAuth } from '../../stores/auth';
import { VacationBalanceCard } from './VacationBalanceCard';

const fetchMock = vi.fn<typeof fetch>();

const BALANCE: VacationBalance = {
  employeeId: 'e1',
  asOf: '2026-09-23',
  contractType: {
    id: 'ct1',
    name: 'Tiempo completo',
    vacationDaysPerYear: 15,
    vacationAccrual: 'ANNUAL',
    vacationDayCounting: 'WORKING_DAYS',
    seniority: null,
    vacationExpiryMonths: null,
    allowNegativeVacationBalance: false,
  },
  accrual: { completedServiceYears: 1, currentYearEntitlement: 15, nextCreditOn: '2027-01-06' },
  accruedDays: 15,
  adjustmentDays: 2.5,
  usedDays: 3,
  scheduledDays: 5,
  pendingDays: 2,
  expiredDays: 0,
  nextExpiry: null,
  availableDays: 7.5,
  adjustments: [
    {
      id: 'a1',
      days: 2.5,
      reason: 'Saldo del sistema anterior',
      createdAt: '2026-09-01T15:00:00Z',
    },
  ],
};

function renderCard(balance: VacationBalance = BALANCE, manage = false) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/vacation-balance')) return Response.json(balance);
    if (url === '/api/contract-types') {
      return Response.json([
        BALANCE.contractType,
        { ...BALANCE.contractType, id: 'ct2', name: 'Medio tiempo' },
      ]);
    }
    if (init?.method && init.method !== 'GET') return Response.json({});
    return new Response(null, { status: 404 });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <VacationBalanceCard employeeId="e1" title="Mis vacaciones" manage={manage} />
    </QueryClientProvider>,
  );
}

const sent = (method: string) => {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === method);
  return call && { url: String(call[0]), body: JSON.parse(String(call[1]?.body)) };
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  useAuth.setState({ status: 'authenticated', accessToken: 'token' });
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('formatDays', () => {
  it.each([
    [1, '1 día'],
    [15, '15 días'],
    [7.5, '7,5 días'],
    [-1, '-1 día'],
    [0, '0 días'],
  ])('%s → %s', (days, text) => {
    expect(formatDays(days)).toBe(text);
  });
});

describe('VacationBalanceCard', () => {
  it('shows what is available and every figure it comes from', async () => {
    renderCard();
    expect(await screen.findByText('7,5 días')).toBeVisible();
    expect(screen.getByText('Tiempo completo · Días hábiles')).toBeVisible();

    const figure = (label: string) =>
      screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent;
    expect(figure('Devengados')).toBe('15 días');
    expect(figure('Ajustes')).toBe('+2,5 días');
    expect(figure('Usados')).toBe('3 días');
    expect(figure('Programados')).toBe('5 días');
    expect(figure('Pendientes')).toBe('2 días');
    expect(screen.getByText(/próximo abono el/)).toBeVisible();
    expect(screen.getByText('Saldo del sistema anterior')).toBeVisible();
    // Days never expire under this contract: nothing to say about it.
    expect(screen.queryByText('Caducados', { selector: 'dt' })).toBeNull();
    expect(screen.queryByText(/caducan el/)).toBeNull();
  });

  it('shows what expired and warns about the next days due to expire', async () => {
    renderCard({
      ...BALANCE,
      contractType: { ...BALANCE.contractType!, vacationExpiryMonths: 12 },
      expiredDays: 4,
      nextExpiry: { date: '2027-01-06', days: 6.5 },
    });
    expect(
      await screen.findByText('6,5 días caducan el 6 ene 2027 si no se usan antes'),
    ).toBeVisible();
    expect(screen.getByText('Caducados', { selector: 'dt' }).nextElementSibling?.textContent).toBe(
      '4 días',
    );
  });

  it('says so when the employee has no contract type', async () => {
    renderCard({ ...BALANCE, contractType: null, accrual: null, availableDays: 0 });
    expect(
      await screen.findByText('Sin tipo de contrato: no se calcula el derecho a vacaciones'),
    ).toBeVisible();
    expect(screen.queryByText(/próximo abono/)).toBeNull();
  });

  it('shows a negative balance (an advance) as such', async () => {
    renderCard({ ...BALANCE, availableDays: -2 });
    expect(await screen.findByText('-2 días')).toHaveClass('text-critical');
  });

  it('offers no controls to someone who only reads', async () => {
    renderCard();
    await screen.findByText('7,5 días');
    expect(screen.queryByRole('form', { name: 'Ajustar saldo' })).toBeNull();
    expect(screen.queryByLabelText('Tipo de contrato')).toBeNull();
  });

  it('lets HR record a justified adjustment', async () => {
    renderCard(BALANCE, true);
    const form = await screen.findByRole('form', { name: 'Ajustar saldo' });
    const submit = within(form).getByRole('button', { name: 'Ajustar' });

    await userEvent.type(within(form).getByLabelText('Días'), '-1.5');
    expect(submit).toBeDisabled(); // no reason yet
    await userEvent.type(within(form).getByLabelText('Motivo del ajuste'), 'Corrección de saldo');
    await userEvent.click(submit);

    await waitFor(() =>
      expect(sent('POST')).toEqual({
        url: '/api/employees/e1/vacation-adjustments',
        body: { days: -1.5, reason: 'Corrección de saldo' },
      }),
    );
  });

  it('lets HR change or remove the contract type', async () => {
    renderCard(BALANCE, true);
    const select = await screen.findByLabelText('Tipo de contrato');
    await screen.findByRole('option', { name: 'Medio tiempo' });
    expect(screen.getByRole('button', { name: 'Cambiar' })).toBeDisabled();

    await userEvent.selectOptions(select, '');
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar' }));
    await waitFor(() =>
      expect(sent('PATCH')).toEqual({ url: '/api/employees/e1', body: { contractTypeId: null } }),
    );
  });
});
