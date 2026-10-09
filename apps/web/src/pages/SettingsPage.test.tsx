import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendancePolicy } from '../lib/types';
import { useAuth } from '../stores/auth';
import { SettingsPage } from './SettingsPage';

const fetchMock = vi.fn<typeof fetch>();

const POLICY: AttendancePolicy = {
  duplicatePunchWindowSeconds: 60,
  lateToleranceMinutes: 5,
  earlyLeaveToleranceMinutes: 0,
  overtimeThresholdMinutes: 15,
  overtimeBasis: 'AFTER_SHIFT_END',
  countEarlyArrivalAsOvertime: false,
  punchPairing: 'SEQUENTIAL',
  autoDeductUnpunchedBreak: true,
  minBreakMinutes: 0,
  outOfScheduleMarginMinutes: 180,
  punchWindowBeforeShiftMinutes: 240,
  punchWindowAfterShiftMinutes: 360,
};

function renderPage(role: 'ADMIN' | 'HR' = 'ADMIN') {
  useAuth.setState({
    status: 'authenticated',
    accessToken: 'token',
    user: { id: 'u1', email: 'a@e.local', role, employeeId: null, displayName: 'A' },
  });
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method === 'PATCH') {
      return Response.json({ ...POLICY, ...JSON.parse(String(init.body)) });
    }
    if (init?.method === 'POST') return Response.json({ recomputed: 42 });
    if (url === '/api/settings') {
      return Response.json({ timezone: 'America/Guayaquil', attendancePolicy: POLICY });
    }
    return new Response(null, { status: 404 });
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SettingsPage />
    </QueryClientProvider>,
  );
}

const sent = (method: string) => {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === method);
  return call && { url: String(call[0]), body: call[1]?.body && JSON.parse(String(call[1].body)) };
};
const policyForm = () => screen.findByRole('form', { name: 'Reglas de asistencia' });

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('SettingsPage', () => {
  it('shows the rules in force, explained', async () => {
    renderPage();
    const form = await policyForm();
    expect(within(form).getByLabelText('Tolerancia de atraso (min)')).toHaveValue(5);
    expect(within(form).getByLabelText('Entradas y salidas')).toHaveValue('SEQUENTIAL');
    expect(
      within(form).getByLabelText('Descontar el almuerzo programado si no se marcó'),
    ).toBeChecked();
    expect(screen.getByText(/America\/Guayaquil/)).toBeVisible();
  });

  it('saves only the rules that changed', async () => {
    renderPage();
    const form = await policyForm();
    const save = within(form).getByRole('button', { name: 'Guardar reglas' });
    expect(save).toBeDisabled();

    const tolerance = within(form).getByLabelText('Tolerancia de atraso (min)');
    await userEvent.clear(tolerance);
    await userEvent.type(tolerance, '10');
    await userEvent.selectOptions(
      within(form).getByLabelText('Qué cuenta como hora extra'),
      'EXCESS_WORKED_TIME',
    );
    await userEvent.click(save);

    await waitFor(() =>
      expect(sent('PATCH')).toEqual({
        url: '/api/settings/attendance-policy',
        body: { lateToleranceMinutes: 10, overtimeBasis: 'EXCESS_WORKED_TIME' },
      }),
    );
    expect(await within(form).findByRole('status')).toHaveTextContent('Reglas guardadas');
    expect(save).toBeDisabled();
  });

  it('will not save a value outside the allowed range', async () => {
    renderPage();
    const form = await policyForm();
    const tolerance = within(form).getByLabelText('Tolerancia de atraso (min)');
    await userEvent.clear(tolerance);
    await userEvent.type(tolerance, '999');
    expect(within(form).getByRole('button', { name: 'Guardar reglas' })).toBeDisabled();
  });

  it('only counts early arrivals as overtime when overtime starts at the shift end', async () => {
    renderPage();
    const form = await policyForm();
    const early = within(form).getByLabelText('Contar la llegada anticipada como hora extra');
    expect(early).toBeEnabled();
    await userEvent.selectOptions(
      within(form).getByLabelText('Qué cuenta como hora extra'),
      'EXCESS_WORKED_TIME',
    );
    expect(early).toBeDisabled();
  });

  it('lets talent management read the rules but not change them', async () => {
    renderPage('HR');
    const form = await policyForm();
    expect(within(form).getByLabelText('Tolerancia de atraso (min)')).toBeDisabled();
    expect(within(form).queryByRole('button', { name: 'Guardar reglas' })).toBeNull();
    expect(screen.getByText(/solo un administrador puede cambiarlas/)).toBeVisible();
    // HR may still recompute: it is attendance work, not a settings change.
    expect(screen.getByRole('form', { name: 'Recalcular jornadas' })).toBeVisible();
  });

  it('recomputes a range of at most 31 days', async () => {
    renderPage();
    const form = await screen.findByRole('form', { name: 'Recalcular jornadas' });
    const from = within(form).getByLabelText('Desde');
    const to = within(form).getByLabelText('Hasta');
    await userEvent.clear(from);
    await userEvent.type(from, '2026-08-01');
    await userEvent.clear(to);
    await userEvent.type(to, '2026-09-15');
    expect(within(form).getByRole('alert')).toHaveTextContent('31 días');
    expect(within(form).getByRole('button', { name: 'Recalcular' })).toBeDisabled();

    await userEvent.clear(to);
    await userEvent.type(to, '2026-08-31');
    await userEvent.click(within(form).getByRole('button', { name: 'Recalcular' }));
    expect(await within(form).findByRole('status')).toHaveTextContent(
      'Se recalcularon 42 jornadas.',
    );
    expect(sent('POST')).toEqual({
      url: '/api/attendance/recompute',
      body: { from: '2026-08-01', to: '2026-08-31' },
    });
  });
});
