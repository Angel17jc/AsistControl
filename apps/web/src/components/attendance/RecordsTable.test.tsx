import type { Role } from '@asistcontrol/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceRecordRow, EmployeeRow } from '../../lib/types';
import { useAuth } from '../../stores/auth';
import { RecordsTable } from './RecordsTable';

const fetchMock = vi.fn<typeof fetch>();

const ANA = {
  id: 'e1',
  employeeCode: 'EMP-0001',
  firstName: 'Ana',
  lastName: 'Vera',
  department: { id: 'd1', name: 'Ventas' },
} as EmployeeRow;

/** A day of Ana's; times in `rest.segments` are local "HH:MM" in Guayaquil (UTC-5). */
const record = (workDate: string, rest: Partial<AttendanceRecordRow>): AttendanceRecordRow => {
  const [y, mo, d] = workDate.split('-').map(Number) as [number, number, number];
  const t = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number) as [number, number];
    return new Date(Date.UTC(y, mo - 1, d, h + 5, m)).toISOString();
  };
  return {
    id: `r-${workDate}`,
    employeeId: ANA.id,
    workDate,
    status: 'PRESENT',
    scheduledStart: t('08:00'),
    scheduledEnd: t('17:00'),
    firstIn: t('08:00'),
    lastOut: t('17:00'),
    segments: [{ in: t('08:00'), out: t('17:00') }],
    workedMinutes: 480,
    breakMinutes: 60,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    overtimeMinutes: 0,
    anomalies: [],
    isFinal: true,
    employee: { ...ANA, department: { name: 'Ventas' } },
    ...rest,
    ...(rest.segments?.length
      ? {
          segments: rest.segments.map((s) => ({
            in: s.in && t(s.in),
            out: s.out && t(s.out),
          })),
          // As the API derives them: the first entry and the last exit there is.
          firstIn: t(rest.segments.find((s) => s.in)!.in!),
          lastOut: t(rest.segments.findLast((s) => s.out)!.out!),
        }
      : {}),
  };
};

// Newest first, as the API sends them.
const RECORDS: AttendanceRecordRow[] = [
  record('2026-10-02', {
    status: 'LATE',
    lateMinutes: 12,
    segments: [
      { in: '08:12', out: '12:01' },
      { in: '13:00', out: '16:45' },
    ],
    workedMinutes: 454,
    breakMinutes: 59,
    earlyLeaveMinutes: 15,
    anomalies: ['LATE_ARRIVAL', 'EARLY_LEAVE'],
  }),
  record('2026-10-01', { overtimeMinutes: 90, workedMinutes: 570 }),
  record('2026-09-30', {
    status: 'ABSENT',
    firstIn: null,
    lastOut: null,
    segments: [],
    workedMinutes: 0,
    breakMinutes: 0,
  }),
  // Came back at 21:00 and never punched out.
  record('2026-09-29', {
    status: 'INCOMPLETE',
    segments: [
      { in: '08:00', out: '12:00' },
      { in: '21:00', out: null },
    ],
    workedMinutes: 240,
    breakMinutes: 540,
    anomalies: ['MISSING_CHECK_OUT'],
  }),
];

function renderTable(role: Role, employeeId: string | null = null) {
  useAuth.setState({
    status: 'authenticated',
    accessToken: 'token',
    user: {
      id: 'u1',
      email: 'x@e.local',
      role,
      employeeId,
      displayName: 'X',
      mustChangePassword: false,
    },
  });
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith('/api/employees')) {
      return Response.json({
        data: [ANA],
        meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
      });
    }
    if (url.startsWith('/api/attendance/records')) {
      return Response.json({
        data: RECORDS,
        meta: { page: 1, pageSize: 25, total: RECORDS.length, totalPages: 1 },
      });
    }
    return new Response(null, { status: 404 });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RecordsTable from="2026-09-30" to="2026-10-02" />
    </QueryClientProvider>,
  );
}

const lastRecordsUrl = () =>
  new URL(
    String(
      fetchMock.mock.calls
        .filter(([input]) => String(input).startsWith('/api/attendance/records'))
        .at(-1)![0],
    ),
    'http://x',
  );
const dates = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('cell')[0]!.textContent);

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('RecordsTable', () => {
  it('shows entry, lunch and exit of each day', async () => {
    renderTable('HR');
    const late = (await screen.findByText('vie, 2 oct')).closest('tr')!;
    expect(late).toHaveTextContent('08:12');
    expect(late).toHaveTextContent('12:01–13:00');
    expect(late).toHaveTextContent('16:45');
    expect(late).toHaveTextContent('15 min antes');
    // A return nobody closed: no exit, and the earlier exit shows as a pause.
    const open = screen.getByText('mar, 29 sept').closest('tr')!;
    expect(within(open).getAllByRole('cell')[6]).toHaveTextContent('—');
    expect(open).toHaveTextContent('12:00–21:00');
    // Lunch not punched, deducted from the schedule.
    expect(screen.getByText('jue, 1 oct').closest('tr')).toHaveTextContent('1h 00m sin marcar');
    expect(screen.getByRole('columnheader', { name: 'Empleado' })).toBeInTheDocument();
  });

  it("turns into an employee's time card with totals and a print button", async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    renderTable('HR');
    const user = userEvent.setup();
    await screen.findByRole('option', { name: 'Vera Ana' });
    await user.selectOptions(screen.getByLabelText('Empleado'), 'e1');

    const card = await screen.findByRole('region', { name: 'Tarjeta de tiempo' });
    expect(card).toHaveTextContent('Tarjeta de tiempo · Vera Ana');
    expect(card).toHaveTextContent('EMP-0001 · Ventas');
    const total = (label: string) => within(card).getByText(label).nextElementSibling;
    expect(total('Días trabajados')).toHaveTextContent('3');
    expect(total('Trabajado')).toHaveTextContent('21h 04m');
    expect(total('Atrasos')).toHaveTextContent('1 · 12 min');
    expect(total('Horas extra')).toHaveTextContent('1h 30m');
    expect(total('Ausencias')).toHaveTextContent('1');

    // The whole period on one page, oldest day first, without the employee column.
    await waitFor(() => expect(lastRecordsUrl().searchParams.get('employeeId')).toBe('e1'));
    expect(lastRecordsUrl().searchParams.get('pageSize')).toBe('100');
    expect(dates()).toEqual(['mar, 29 sept', 'mié, 30 sept', 'jue, 1 oct', 'vie, 2 oct']);
    expect(screen.queryByRole('columnheader', { name: 'Empleado' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Imprimir' }));
    expect(print).toHaveBeenCalled();
  });

  it('shows an employee their own card', async () => {
    renderTable('EMPLOYEE', 'e1');
    expect(await screen.findByRole('region', { name: 'Tarjeta de tiempo' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Empleado')).not.toBeInTheDocument();
    expect(lastRecordsUrl().searchParams.get('employeeId')).toBe('e1');
  });
});
