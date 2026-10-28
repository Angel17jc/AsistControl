import type { PresenceBoard, PresenceEntry } from '@asistcontrol/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../stores/auth';
import { PresencePage } from './PresencePage';

const fetchMock = vi.fn<typeof fetch>();

/** 12:30 in Guayaquil (UTC-5) on 2026-09-18; the office shift is 08:00–17:00. */
const AT = '2026-09-18T17:30:00.000Z';
const SHIFT = {
  start: '2026-09-18T13:00:00.000Z',
  end: '2026-09-18T22:00:00.000Z',
  breakStart: '2026-09-18T17:00:00.000Z',
  breakEnd: '2026-09-18T18:00:00.000Z',
};

const entry = (
  id: string,
  name: string,
  department: string | null,
  rest: Partial<PresenceEntry>,
): PresenceEntry => ({
  employee: { id, employeeCode: `EMP-${id}`, firstName: name, lastName: 'Vera', department },
  state: 'IN',
  workDate: '2026-09-18',
  shift: SHIFT,
  expectedStart: SHIFT.start,
  expectedEnd: SHIFT.end,
  firstIn: null,
  lateMinutes: 0,
  lastPunch: null,
  leaveType: null,
  ...rest,
});

const ENTRIES: PresenceEntry[] = [
  entry('1', 'Ana', 'Ventas', {
    state: 'IN',
    firstIn: '2026-09-18T13:12:00.000Z',
    lateMinutes: 12,
    lastPunch: { at: '2026-09-18T13:12:00.000Z', reading: 'CHECK_IN', deviceName: 'Recepción' },
  }),
  entry('2', 'Beto', 'Bodega', {
    state: 'ON_BREAK',
    firstIn: '2026-09-18T13:00:00.000Z',
    lastPunch: { at: '2026-09-18T17:01:00.000Z', reading: 'CHECK_OUT', deviceName: 'Recepción' },
  }),
  entry('3', 'Carla', 'Ventas', {
    state: 'LEFT',
    firstIn: '2026-09-18T13:00:00.000Z',
    lastPunch: { at: '2026-09-18T16:00:00.000Z', reading: 'CHECK_OUT', deviceName: null },
  }),
  entry('4', 'Dario', 'Bodega', { state: 'NOT_ARRIVED' }),
  // A morning shift (06:00–12:00) already over without a single punch.
  entry('7', 'Gina', 'Bodega', {
    state: 'NOT_ARRIVED',
    expectedStart: '2026-09-18T11:00:00.000Z',
    expectedEnd: '2026-09-18T17:00:00.000Z',
  }),
  entry('5', 'Elena', 'Ventas', { state: 'ON_LEAVE', leaveType: 'MEDICAL' }),
  entry('6', 'Fabio', null, {
    state: 'IN',
    workDate: '2026-09-17',
    shift: null,
    lastPunch: { at: '2026-09-18T03:05:00.000Z', reading: 'CHECK_IN', deviceName: 'Patio' },
  }),
];

const BOARD: PresenceBoard = {
  at: AT,
  timezone: 'America/Guayaquil',
  counts: {
    IN: 2,
    ON_BREAK: 1,
    LEFT: 1,
    NOT_ARRIVED: 2,
    NOT_YET: 0,
    ON_LEAVE: 1,
    DAY_OFF: 0,
    NO_SCHEDULE: 0,
  },
  entries: ENTRIES,
};

function renderPage() {
  fetchMock.mockImplementation(async (input) =>
    String(input).startsWith('/api/attendance/presence')
      ? Response.json(BOARD)
      : new Response(null, { status: 404 }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PresencePage />
    </QueryClientProvider>,
  );
}

const rowOf = (name: string) => screen.getByText(`Vera ${name}`).closest('tr')!;
const visibleNames = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('cell')[0]!.querySelector('p')!.textContent);

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  useAuth.setState({ status: 'authenticated', accessToken: 'token' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('PresencePage', () => {
  it('says where each person is and since when', async () => {
    renderPage();
    expect(await screen.findByText('Vera Ana')).toBeInTheDocument();
    expect(screen.getByText(/Quién está ahora, 12:30/)).toBeInTheDocument();

    expect(rowOf('Ana')).toHaveTextContent('En la empresa');
    expect(rowOf('Ana')).toHaveTextContent('desde 08:12');
    expect(rowOf('Ana')).toHaveTextContent('12 min tarde');
    expect(rowOf('Ana')).toHaveTextContent('Recepción');
    expect(rowOf('Beto')).toHaveTextContent('En almuerzo');
    expect(rowOf('Beto')).toHaveTextContent('desde 12:01 · vuelve 13:00');
    expect(rowOf('Carla')).toHaveTextContent('a las 11:00 · antes de su hora');
    expect(rowOf('Carla')).toHaveTextContent('Manual');
    expect(rowOf('Dario')).toHaveTextContent('debía entrar 08:00');
    expect(rowOf('Gina')).toHaveTextContent('no marcó en todo su turno');
    expect(rowOf('Elena')).toHaveTextContent('Médico');
    // A night shift's entry from the evening before carries its date.
    expect(rowOf('Fabio')).toHaveTextContent('desde 22:05 (jue, 17 sept)');
  });

  it('counts each state and filters by it', async () => {
    renderPage();
    const user = userEvent.setup();
    const chip = await screen.findByRole('button', { name: /En la empresa\s*2/ });
    expect(screen.getByRole('button', { name: /No ha llegado\s*2/ })).toBeInTheDocument();

    await user.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(visibleNames()).toEqual(['Vera Ana', 'Vera Fabio']);

    await user.click(chip);
    expect(visibleNames()).toHaveLength(7);
  });

  it('narrows the board by department and by name', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Departamento'), 'Bodega');
    expect(visibleNames()).toEqual(['Vera Beto', 'Vera Dario', 'Vera Gina']);
    // The counts follow the department.
    expect(screen.getByRole('button', { name: /En la empresa\s*0/ })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Departamento'), '');
    await user.type(screen.getByLabelText('Buscar'), 'EMP-5');
    expect(visibleNames()).toEqual(['Vera Elena']);
  });
});
