import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DayPreview, EmployeeRow } from '../../lib/types';
import { useAuth } from '../../stores/auth';
import { ManualPunchForm } from './ManualPunchForm';

const fetchMock = vi.fn<typeof fetch>();
const DATE = '2026-09-14';

const ANA = {
  id: 'e1',
  employeeCode: 'EMP-0001',
  firstName: 'Ana',
  lastName: 'Vera',
} as EmployeeRow;

const SUMMARY = {
  firstIn: null,
  lastOut: null,
  workedMinutes: 0,
  breakMinutes: 0,
  lateMinutes: 0,
  earlyLeaveMinutes: 0,
  overtimeMinutes: 0,
  anomalies: [],
  isFinal: true,
} satisfies Partial<DayPreview['after']>;

/** Ana marked 08:03 and forgot the exit; the proposed punch closes the day. */
const PREVIEW: DayPreview = {
  workDate: DATE,
  dayType: 'WORKDAY',
  hasSchedule: true,
  employed: true,
  punchPairing: 'SEQUENTIAL',
  shift: {
    start: '2026-09-14T13:00:00.000Z',
    end: '2026-09-14T22:00:00.000Z',
    breakStart: '2026-09-14T17:00:00.000Z',
    breakEnd: '2026-09-14T18:00:00.000Z',
  },
  punches: [
    {
      id: 'ev1',
      occurredAt: '2026-09-14T13:03:00.000Z',
      punchType: 'UNKNOWN',
      source: 'DEVICE',
      deviceName: 'Recepción',
      note: null,
      proposed: false,
      reading: 'CHECK_IN',
    },
    {
      id: null,
      occurredAt: '2026-09-14T22:00:00.000Z',
      punchType: 'UNKNOWN',
      source: 'MANUAL',
      deviceName: null,
      note: null,
      proposed: true,
      reading: 'CHECK_OUT',
    },
  ],
  before: { ...SUMMARY, status: 'INCOMPLETE', anomalies: ['MISSING_CHECK_OUT'] },
  after: { ...SUMMARY, status: 'PRESENT', workedMinutes: 477 },
};

function renderForm({
  preview = PREVIEW,
  create = () => Response.json([]),
}: { preview?: DayPreview; create?: () => Response } = {}) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith('/api/employees')) {
      return Response.json({
        data: [ANA],
        meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
      });
    }
    if (url === '/api/attendance/events/preview') return Response.json(preview);
    if (url === '/api/attendance/events/batch') return create();
    return new Response(null, { status: 404 });
  });
  const onDone = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ManualPunchForm onDone={onDone} />
    </QueryClientProvider>,
  );
  return onDone;
}

/** Body of the last request sent to a path. */
const lastBody = (path: string) => {
  const call = fetchMock.mock.calls.filter(([input]) => String(input) === path).at(-1);
  return call && JSON.parse(String(call[1]?.body));
};

/** Same conversion as the form: the operator's local time on that date. */
const local = (date: string, time: string) => new Date(`${date}T${time}:00`).toISOString();

async function chooseAnaOn(date: string) {
  const user = userEvent.setup();
  await user.selectOptions(
    await screen.findByLabelText('Empleado'),
    await screen.findByRole('option', { name: 'Vera Ana' }),
  );
  setValue('Fecha', date);
  return user;
}

/** Date and time inputs take a whole value at once, as the browser's picker sets it. */
const setValue = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  useAuth.setState({ status: 'authenticated', accessToken: 'token' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('ManualPunchForm', () => {
  it('shows how the whole day will be read before saving anything', async () => {
    renderForm();
    await chooseAnaOn(DATE);
    setValue('Hora', '17:00');

    const panel = await screen.findByRole('region', { name: 'Cómo quedará la jornada' });
    expect(within(panel).getByText(/Turno 08:00–17:00 · almuerzo 12:00–13:00/)).toBeInTheDocument();
    const rows = within(panel).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('08:03Entrada');
    expect(rows[0]).toHaveTextContent('Recepción');
    expect(rows[1]).toHaveTextContent('17:00Salida');
    expect(rows[1]).toHaveTextContent('Nueva');
    expect(within(panel).getByText('Incompleta')).toBeInTheDocument();
    expect(within(panel).getByText('Presente')).toBeInTheDocument();
    expect(within(panel).getByText('7h 57m')).toBeInTheDocument();

    await waitFor(() =>
      expect(lastBody('/api/attendance/events/preview')).toEqual({
        employeeId: 'e1',
        punches: [{ occurredAt: local(DATE, '17:00'), punchType: 'UNKNOWN' }],
      }),
    );
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/batch'))).toBe(false);
  });

  it('registers a whole day with the shift times and one reason', async () => {
    const onDone = renderForm();
    const user = await chooseAnaOn(DATE);
    await user.selectOptions(screen.getByLabelText('¿Qué falta?'), 'day');
    setValue('Hora de entrada', '09:30');

    await user.click(await screen.findByRole('button', { name: 'Usar su turno (08:00–17:00)' }));
    expect(screen.getByLabelText('Hora de entrada')).toHaveValue('08:00');
    expect(screen.getByLabelText('Hora de salida')).toHaveValue('17:00');

    const submit = screen.getByRole('button', { name: 'Registrar entrada y salida' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('Motivo'), 'El marcador no tenía luz');
    await user.click(submit);

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(lastBody('/api/attendance/events/batch')).toEqual({
      employeeId: 'e1',
      punches: [
        { occurredAt: local(DATE, '08:00'), punchType: 'CHECK_IN' },
        { occurredAt: local(DATE, '17:00'), punchType: 'CHECK_OUT' },
      ],
      reason: 'El marcador no tenía luz',
    });
  });

  it('takes an exit earlier than the entry from the next day, as in a night shift', async () => {
    renderForm();
    const user = await chooseAnaOn(DATE);
    await user.selectOptions(screen.getByLabelText('¿Qué falta?'), 'day');
    setValue('Hora de entrada', '22:00');
    setValue('Hora de salida', '06:00');

    await waitFor(() =>
      expect(lastBody('/api/attendance/events/preview').punches).toEqual([
        { occurredAt: local(DATE, '22:00'), punchType: 'CHECK_IN' },
        { occurredAt: local('2026-09-15', '06:00'), punchType: 'CHECK_OUT' },
      ]),
    );
  });

  it('asks for the key only when the company pairs punches by the key pressed', async () => {
    renderForm({ preview: { ...PREVIEW, punchPairing: 'DEVICE_TYPE' } });
    const user = await chooseAnaOn(DATE);
    await screen.findByRole('region', { name: 'Cómo quedará la jornada' });

    await user.selectOptions(screen.getByLabelText('Tipo'), 'Salida');
    await waitFor(() =>
      expect(lastBody('/api/attendance/events/preview').punches[0].punchType).toBe('CHECK_OUT'),
    );
  });

  it('hides the key choice when punches are read in order', async () => {
    renderForm();
    await chooseAnaOn(DATE);
    await screen.findByRole('region', { name: 'Cómo quedará la jornada' });
    expect(screen.queryByLabelText('Tipo')).not.toBeInTheDocument();
    expect(screen.getByText(/se leen por orden de hora/)).toBeInTheDocument();
  });

  it('warns about a day outside the employment and a missing schedule', async () => {
    renderForm({ preview: { ...PREVIEW, employed: false, hasSchedule: false, shift: null } });
    await chooseAnaOn(DATE);
    const panel = await screen.findByRole('region', { name: 'Cómo quedará la jornada' });
    expect(within(panel).getByText(/fuera de su período de trabajo/)).toBeInTheDocument();
    expect(within(panel).getByText(/Sin horario asignado/)).toBeInTheDocument();
  });

  it('dates the punches of the next day and warns about a time outside the day', async () => {
    const [saved, proposed] = PREVIEW.punches as [
      DayPreview['punches'][number],
      DayPreview['punches'][number],
    ];
    renderForm({
      preview: {
        ...PREVIEW,
        punches: [
          { ...proposed, occurredAt: '2026-09-14T22:05:00.000Z', reading: 'OTHER_DAY' },
          { ...saved, occurredAt: '2026-09-15T12:55:00.000Z' },
        ],
      },
    });
    await chooseAnaOn(DATE);
    const panel = await screen.findByRole('region', { name: 'Cómo quedará la jornada' });

    expect(within(panel).getByText(/queda fuera de esta jornada/)).toBeInTheDocument();
    const rows = within(panel).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('17:05Fuera de esta jornada');
    expect(rows[1]).toHaveTextContent(/07:55\s*\(mar, 15 sept\)Entrada/);
  });

  it('explains a punch that already exists in plain words', async () => {
    renderForm({
      create: () =>
        Response.json(
          {
            statusCode: 409,
            error: 'Conflict',
            message: 'A manual punch already exists at that time',
          },
          { status: 409 },
        ),
    });
    const user = await chooseAnaOn(DATE);
    await user.type(screen.getByLabelText('Motivo'), 'Olvidó marcar');
    await user.click(screen.getByRole('button', { name: 'Registrar marcación' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ya hay una marcación manual de esta persona a esa hora.',
    );
  });
});
