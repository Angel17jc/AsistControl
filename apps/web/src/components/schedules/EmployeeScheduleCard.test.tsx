import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleAssignmentRow, WorkScheduleRow } from '../../lib/types';
import { useAuth } from '../../stores/auth';
import { EmployeeScheduleCard } from './EmployeeScheduleCard';

const fetchMock = vi.fn<typeof fetch>();

const office = { name: 'Oficina', startTime: '08:00', endTime: '17:00' };
const night = { name: 'Noche', startTime: '22:00', endTime: '06:00' };
const SCHEDULES: WorkScheduleRow[] = [
  {
    id: 's-office',
    name: 'Administrativo L-V',
    description: null,
    days: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, shift: office })),
  },
  {
    id: 's-night',
    name: 'Nocturno',
    description: null,
    days: [1, 2, 3, 4].map((weekday) => ({ weekday, shift: night })),
  },
];
const HISTORY: ScheduleAssignmentRow[] = [
  {
    id: 'a3',
    effectiveFrom: '2026-10-01',
    effectiveTo: null,
    schedule: { id: 's-night', name: 'Nocturno' },
  },
  {
    id: 'a2',
    effectiveFrom: '2026-03-01',
    effectiveTo: '2026-09-30',
    schedule: { id: 's-office', name: 'Administrativo L-V' },
  },
  {
    id: 'a1',
    effectiveFrom: '2025-01-06',
    effectiveTo: '2026-02-28',
    schedule: { id: 's-night', name: 'Nocturno' },
  },
];

function renderCard({ manage = true, history = HISTORY } = {}) {
  useAuth.setState({
    status: 'authenticated',
    accessToken: 'token',
    user: { id: 'u1', email: 'hr@e.local', role: 'HR', employeeId: null, displayName: 'RRHH' },
  });
  fetchMock.mockImplementation(async (input, init) => {
    if (init?.method && init.method !== 'GET') return new Response(null, { status: 204 });
    return Response.json(String(input).includes('/schedules') ? history : SCHEDULES);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <EmployeeScheduleCard employeeId="e1" title="Horario de Ana" manage={manage} />
    </QueryClientProvider>,
  );
}

const sent = (method: string) => {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === method);
  return call && { url: String(call[0]), body: call[1]?.body && JSON.parse(String(call[1].body)) };
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  // Only the clock: React Query and user-event keep their real timers.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-24T15:00:00Z'));
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('EmployeeScheduleCard', () => {
  it('shows each period with its week and whether it is in force', async () => {
    renderCard();
    const list = await screen.findByRole('list', { name: 'Historial de horarios' });
    const [scheduled, current, past] = within(list).getAllByRole('listitem');

    expect(within(scheduled!).getByText('Programado')).toBeVisible();
    expect(within(scheduled!).getByText('desde 1 oct 2026')).toBeVisible();
    expect(within(current!).getByText('Vigente')).toBeVisible();
    expect(within(current!).getByText('1 mar 2026 – 30 sept 2026')).toBeVisible();
    expect(await within(current!).findByText('lun–vie 08:00–17:00')).toBeVisible();
    expect(within(past!).getByText('Anterior')).toBeVisible();
    expect(within(past!).getByText('lun–jue 22:00–06:00')).toBeVisible();
  });

  it('assigns a schedule from a date', async () => {
    renderCard();
    const form = await screen.findByRole('form', { name: 'Asignar horario' });
    await userEvent.selectOptions(
      within(form).getByLabelText('Nuevo horario'),
      await within(form).findByRole('option', { name: 'Administrativo L-V' }),
    );
    expect(within(form).getByText('lun–vie 08:00–17:00')).toBeVisible();

    const from = within(form).getByLabelText('Desde');
    await userEvent.clear(from);
    await userEvent.type(from, '2026-11-02');
    await userEvent.click(within(form).getByRole('button', { name: 'Asignar' }));

    await waitFor(() =>
      expect(sent('POST')).toEqual({
        url: '/api/work-schedules/assignments',
        body: { employeeId: 'e1', scheduleId: 's-office', effectiveFrom: '2026-11-02' },
      }),
    );
  });

  it('will not start a schedule on or before the latest one', async () => {
    renderCard();
    const form = await screen.findByRole('form', { name: 'Asignar horario' });
    await userEvent.selectOptions(
      within(form).getByLabelText('Nuevo horario'),
      await within(form).findByRole('option', { name: 'Nocturno' }),
    );
    // Today (24 Sep) is before the scheduled change of 1 Oct.
    expect(within(form).getByLabelText('Desde')).toHaveAccessibleDescription(
      'Debe ser posterior al 1 oct 2026',
    );
    expect(within(form).getByRole('button', { name: 'Asignar' })).toBeDisabled();
  });

  it('undoes the latest assignment after confirming', async () => {
    renderCard();
    await userEvent.click(await screen.findByRole('button', { name: 'Deshacer último cambio' }));
    expect(screen.getByText(/¿Deshacer Nocturno desde el 1 oct 2026\?/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Sí, deshacer' }));
    await waitFor(() => expect(sent('DELETE')?.url).toBe('/api/work-schedules/assignments/a3'));
  });

  it('does not offer to undo an assignment older than the recompute window', async () => {
    renderCard({ history: HISTORY.slice(1).map((a, i) => (i ? a : { ...a, effectiveTo: null })) });
    await screen.findByRole('list', { name: 'Historial de horarios' });
    expect(screen.queryByRole('button', { name: 'Deshacer último cambio' })).toBeNull();
  });

  it('is read-only without manage', async () => {
    renderCard({ manage: false });
    await screen.findByRole('list', { name: 'Historial de horarios' });
    expect(screen.queryByRole('form', { name: 'Asignar horario' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deshacer último cambio' })).toBeNull();
  });

  it('warns when the employee has no schedule', async () => {
    renderCard({ history: [] });
    expect(await screen.findByText('Sin horario asignado')).toBeVisible();
  });
});
