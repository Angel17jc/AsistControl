import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkScheduleRow } from '../../lib/types';
import { QuickSetupCard } from './QuickSetupCard';

const fetchMock = vi.fn<typeof fetch>();

const COMPANY: WorkScheduleRow = {
  id: 's1',
  name: 'Jornada de la empresa',
  description: null,
  days: [1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    shift: {
      name: 'Jornada sin hora fija',
      startTime: '08:00',
      endTime: '18:30',
      breakStart: '13:00',
      breakEnd: '13:30',
      flexible: true,
    },
  })),
};

function renderCard({
  schedules = [] as WorkScheduleRow[],
  overtimeEnabled = true,
  result = { assigned: 3, onSchedule: 3, kept: 0 },
  /** What this browser already had, as if read earlier in the session. */
  cachedOvertime = undefined as boolean | undefined,
  /** Holds the answer about overtime until it resolves. */
  featuresArrive = Promise.resolve(),
} = {}) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method === 'POST') return Response.json(result, { status: 201 });
    if (url.startsWith('/api/work-schedules')) return Response.json(schedules);
    if (url.startsWith('/api/settings/features')) {
      await featuresArrive;
      return Response.json({ overtimeEnabled });
    }
    return new Response(null, { status: 404 });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cachedOvertime !== undefined) {
    client.setQueryData(['settings', 'features'], { overtimeEnabled: cachedOvertime });
  }
  render(
    <QueryClientProvider client={client}>
      <QuickSetupCard />
    </QueryClientProvider>,
  );
}

const sentBody = () => {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
  return call && (JSON.parse(String(call[1]?.body)) as Record<string, unknown>);
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-04T15:00:00Z'));
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('QuickSetupCard', () => {
  it('proposes the usual day and sends it in minutes', async () => {
    renderCard();
    const form = await screen.findByRole('form', { name: 'Jornada de la empresa' });
    expect(within(form).getByLabelText('Horas de trabajo al día')).toHaveValue(8);
    expect(within(form).getByLabelText('Almuerzo (minutos)')).toHaveValue(60);
    expect(within(form).getByLabelText('Lunes')).toBeChecked();
    expect(within(form).getByLabelText('Viernes')).toBeChecked();
    expect(within(form).getByLabelText('Sábado')).not.toBeChecked();
    expect(within(form).getByLabelText('Aplicar desde')).toHaveValue('2026-11-01');
    expect(within(form).getByLabelText(/La empresa paga horas extra/)).not.toBeChecked();

    await userEvent.click(within(form).getByRole('button', { name: /Aplicar a todos/ }));
    await waitFor(() => expect(sentBody()).toBeDefined());
    expect(sentBody()).toEqual({
      dailyMinutes: 480,
      lunchMinutes: 60,
      weekdays: [1, 2, 3, 4, 5],
      effectiveFrom: '2026-11-01',
      overtimeEnabled: false,
    });
    expect(await within(form).findByRole('status')).toHaveTextContent(
      'Listo: 3 empleados con esta jornada.',
    );
  });

  it('starts from the workday already set, to change it', async () => {
    renderCard({ schedules: [COMPANY] });
    const form = await screen.findByRole('form', { name: 'Jornada de la empresa' });
    await waitFor(() =>
      expect(within(form).getByLabelText('Horas de trabajo al día')).toHaveValue(10),
    );
    expect(within(form).getByLabelText('Almuerzo (minutos)')).toHaveValue(30);
    expect(within(form).getByLabelText('Sábado')).toBeChecked();
    expect(within(form).getByLabelText(/La empresa paga horas extra/)).toBeChecked();
  });

  it('keeps overtime off when the company does not pay it', async () => {
    let arrive = () => {};
    const featuresArrive = new Promise<void>((resolve) => (arrive = resolve));
    renderCard({ schedules: [COMPANY], overtimeEnabled: false, featuresArrive });
    // The schedules are in, the rule is not: the form waits rather than guess.
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/settings/features', expect.anything()),
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(screen.queryByRole('form', { name: 'Jornada de la empresa' })).toBeNull();

    arrive();
    const form = await screen.findByRole('form', { name: 'Jornada de la empresa' });
    expect(within(form).getByLabelText(/La empresa paga horas extra/)).not.toBeChecked();
  });

  it('reads the overtime rule again, in case it changed elsewhere', async () => {
    // On in this browser's memory; switched off since from another session.
    renderCard({ schedules: [COMPANY], overtimeEnabled: false, cachedOvertime: true });
    const form = await screen.findByRole('form', { name: 'Jornada de la empresa' });
    expect(within(form).getByLabelText(/La empresa paga horas extra/)).not.toBeChecked();

    await userEvent.click(within(form).getByRole('button', { name: /Aplicar a todos/ }));
    await waitFor(() => expect(sentBody()).toBeDefined());
    expect(sentBody()).toMatchObject({ overtimeEnabled: false });
  });

  it('needs at least one working day', async () => {
    renderCard();
    const form = await screen.findByRole('form', { name: 'Jornada de la empresa' });
    for (const day of ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes']) {
      await userEvent.click(within(form).getByLabelText(day));
    }
    expect(within(form).getByRole('button', { name: /Aplicar a todos/ })).toBeDisabled();
    expect(within(form).getByText('Elija al menos un día laborable.')).toBeVisible();
  });

  it('says who kept the schedule they had', async () => {
    renderCard({ result: { assigned: 1, onSchedule: 1, kept: 2 } });
    const form = await screen.findByRole('form', { name: 'Jornada de la empresa' });
    await userEvent.click(within(form).getByRole('button', { name: /Aplicar a todos/ }));
    const status = await within(form).findByRole('status');
    expect(status).toHaveTextContent('Listo: 1 empleado con esta jornada.');
    expect(status).toHaveTextContent('2 empleados conservan el horario');
  });

  it('says what happens next when there are no employees yet', async () => {
    renderCard({ result: { assigned: 0, onSchedule: 0, kept: 0 } });
    const form = await screen.findByRole('form', { name: 'Jornada de la empresa' });
    await userEvent.click(within(form).getByRole('button', { name: /Aplicar a todos/ }));
    expect(await within(form).findByRole('status')).toHaveTextContent(
      'la jornada quedó guardada. Los empleados que registre la tendrán desde su ingreso.',
    );
  });

  it('shows what the API refuses', async () => {
    renderCard();
    const form = await screen.findByRole('form', { name: 'Jornada de la empresa' });
    fetchMock.mockImplementationOnce(async () =>
      Response.json(
        { statusCode: 400, code: 'ASSIGNMENT_TOO_OLD', params: { maxDays: 62 } },
        {
          status: 400,
        },
      ),
    );
    await userEvent.click(within(form).getByRole('button', { name: /Aplicar a todos/ }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('62');
  });
});
