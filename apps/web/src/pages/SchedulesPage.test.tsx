import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HolidayRow, WorkScheduleRow, WorkShiftRow } from '../lib/types';
import { useAuth } from '../stores/auth';
import { SchedulesPage } from './SchedulesPage';

const fetchMock = vi.fn<typeof fetch>();

const OFFICE: WorkShiftRow = {
  id: 'sh-office',
  name: 'Oficina',
  startTime: '08:00',
  endTime: '17:00',
  breakStart: '12:00',
  breakEnd: '13:00',
  lateToleranceMinutes: null,
  earlyLeaveToleranceMinutes: null,
  overtimeThresholdMinutes: null,
};
const NIGHT: WorkShiftRow = {
  ...OFFICE,
  id: 'sh-night',
  name: 'Noche',
  startTime: '22:00',
  endTime: '06:00',
  breakStart: null,
  breakEnd: null,
  lateToleranceMinutes: 10,
};
const SCHEDULES: WorkScheduleRow[] = [
  {
    id: 'ws1',
    name: 'Administrativo L-V',
    description: 'Oficinas centrales',
    days: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, shiftId: OFFICE.id, shift: OFFICE })),
  },
];
const HOLIDAYS: HolidayRow[] = [{ id: 'h1', date: '2026-11-02', name: 'Día de los Difuntos' }];

function renderPage(role: 'HR' | 'SUPERVISOR' = 'HR') {
  useAuth.setState({
    status: 'authenticated',
    accessToken: 'token',
    user: { id: 'u1', email: 'hr@e.local', role, employeeId: null, displayName: 'RRHH' },
  });
  fetchMock.mockImplementation(async (input, init) => {
    if (init?.method && init.method !== 'GET') return Response.json({ id: 'new' });
    const url = String(input);
    if (url.startsWith('/api/work-shifts')) return Response.json([OFFICE, NIGHT]);
    if (url.startsWith('/api/work-schedules')) return Response.json(SCHEDULES);
    if (url.startsWith('/api/holidays')) {
      return Response.json(url.includes('year=2026') ? HOLIDAYS : []);
    }
    return new Response(null, { status: 404 });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SchedulesPage />
    </QueryClientProvider>,
  );
}

const sent = (method: string, path: string) => {
  const call = fetchMock.mock.calls.find(
    ([input, init]) => init?.method === method && String(input).startsWith(path),
  );
  return call && { url: String(call[0]), body: call[1]?.body && JSON.parse(String(call[1].body)) };
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-24T15:00:00Z'));
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('SchedulesPage — shifts', () => {
  it('lists shifts with their hours, lunch and tolerances in words', async () => {
    renderPage();
    const office = (await screen.findByText('Oficina')).closest('tr')!;
    expect(within(office).getByText('08:00–17:00')).toBeVisible();
    expect(within(office).getByText('12:00–13:00')).toBeVisible();
    expect(within(office).getByText('Las de la política')).toBeVisible();

    const night = screen.getByText('Noche').closest('tr')!;
    expect(within(night).getByText('22:00–06:00 (+1 día)')).toBeVisible();
    expect(within(night).getByText('atraso 10 min')).toBeVisible();
  });

  it('creates a night shift without lunch; empty tolerances follow the policy', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo turno' }));
    const form = screen.getByRole('form', { name: 'Nuevo turno' });
    await userEvent.type(within(form).getByLabelText('Nombre'), 'Madrugada');
    await userEvent.clear(within(form).getByLabelText('Entrada'));
    await userEvent.type(within(form).getByLabelText('Entrada'), '23:00');
    await userEvent.clear(within(form).getByLabelText('Salida'));
    await userEvent.type(within(form).getByLabelText('Salida'), '07:00');
    expect(within(form).getByLabelText('Salida')).toHaveAccessibleDescription(
      'Termina al día siguiente',
    );
    await userEvent.click(within(form).getByRole('button', { name: 'Crear turno' }));

    await waitFor(() =>
      expect(sent('POST', '/api/work-shifts')?.body).toEqual({
        name: 'Madrugada',
        startTime: '23:00',
        endTime: '07:00',
        breakStart: null,
        breakEnd: null,
        lateToleranceMinutes: null,
        earlyLeaveToleranceMinutes: null,
        overtimeThresholdMinutes: null,
      }),
    );
  });

  it('asks for both lunch times or neither', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Editar turno Oficina' }));
    const form = screen.getByRole('form', { name: 'Editar turno Oficina' });
    await userEvent.clear(within(form).getByLabelText('Almuerzo hasta'));
    expect(within(form).getByRole('button', { name: 'Guardar turno' })).toBeDisabled();
    expect(within(form).getByText('Indique las dos horas del almuerzo, o ninguna.')).toBeVisible();
  });
});

describe('SchedulesPage — weekly schedules', () => {
  it('describes each week in one line', async () => {
    renderPage();
    const row = (await screen.findByText('Administrativo L-V')).closest('tr')!;
    expect(within(row).getByText('lun–vie 08:00–17:00')).toBeVisible();
    expect(within(row).getByText('Oficinas centrales')).toBeVisible();
  });

  it('creates one from a shift per weekday, leaving the rest as rest days', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo horario' }));
    const form = screen.getByRole('form', { name: 'Nuevo horario' });
    await userEvent.type(within(form).getByLabelText('Nombre'), 'Vigilancia fin de semana');
    await within(form).findAllByRole('option', { name: /Noche/ });
    await userEvent.selectOptions(within(form).getByLabelText('Sábado'), 'sh-night');
    await userEvent.selectOptions(within(form).getByLabelText('Domingo'), 'sh-night');
    await userEvent.click(within(form).getByRole('button', { name: 'Crear horario' }));

    await waitFor(() =>
      expect(sent('POST', '/api/work-schedules')?.body).toEqual({
        name: 'Vigilancia fin de semana',
        description: null,
        days: [
          { weekday: 6, shiftId: 'sh-night' },
          { weekday: 7, shiftId: 'sh-night' },
        ],
      }),
    );
  });

  it('edits one starting from its current week', async () => {
    renderPage();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Editar horario Administrativo L-V' }),
    );
    const form = screen.getByRole('form', { name: 'Editar horario Administrativo L-V' });
    await within(form).findAllByRole('option', { name: /Oficina/ });
    expect(within(form).getByLabelText('Lunes')).toHaveValue('sh-office');
    expect(within(form).getByLabelText('Sábado')).toHaveValue('');

    await userEvent.selectOptions(within(form).getByLabelText('Viernes'), '');
    await userEvent.click(within(form).getByRole('button', { name: 'Guardar horario' }));
    await waitFor(() => expect(sent('PATCH', '/api/work-schedules/ws1')).toBeDefined());
    expect(sent('PATCH', '/api/work-schedules/ws1')?.body.days).toHaveLength(4);
  });
});

describe('SchedulesPage — holidays', () => {
  it('shows a year at a time', async () => {
    renderPage();
    expect(await screen.findByText('Día de los Difuntos')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Año siguiente' }));
    expect(await screen.findByText('Feriados 2027')).toBeVisible();
    await waitFor(() => expect(screen.queryByText('Día de los Difuntos')).toBeNull());
  });

  it('adds and removes holidays', async () => {
    renderPage();
    const form = await screen.findByRole('form', { name: 'Nuevo feriado' });
    await userEvent.type(within(form).getByLabelText('Fecha'), '2026-12-25');
    await userEvent.type(within(form).getByLabelText('Nombre del feriado'), 'Navidad');
    await userEvent.click(within(form).getByRole('button', { name: 'Añadir' }));
    await waitFor(() =>
      expect(sent('POST', '/api/holidays')?.body).toEqual({ date: '2026-12-25', name: 'Navidad' }),
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Eliminar feriado Día de los Difuntos' }),
    );
    await waitFor(() => expect(sent('DELETE', '/api/holidays/h1')).toBeDefined());
  });
});

describe('SchedulesPage — read only', () => {
  it('offers no controls without schedules:write', async () => {
    renderPage('SUPERVISOR');
    await screen.findByText('Oficina');
    expect(screen.queryByRole('button', { name: 'Nuevo turno' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Nuevo horario' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Nuevo feriado' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Editar/ })).toBeNull();
  });
});
