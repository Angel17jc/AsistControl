import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportFromDeviceCard } from './ImportFromDeviceCard';

const fetchMock = vi.fn<typeof fetch>();

const PEOPLE = [
  {
    deviceUserId: '1',
    name: 'ANA RUIZ',
    admin: true,
    employee: { id: 'e1', firstName: 'Ana', lastName: 'Ruiz', employeeCode: 'EMP-001' },
  },
  { deviceUserId: '12', name: 'MELANIE ANDREA ZAMBRANO PÉREZ', admin: false, employee: null },
  { deviceUserId: '13', name: 'PEDRO', admin: false, employee: null },
];

function renderCard(people: Response = Response.json(PEOPLE)) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method === 'POST') {
      return Response.json(
        {
          created: [
            { biometricId: '12', employeeId: 'n1', employeeCode: 'EMP-012' },
            { biometricId: '13', employeeId: 'n2', employeeCode: 'EMP-013' },
          ],
          skipped: [],
        },
        { status: 201 },
      );
    }
    if (url.startsWith('/api/devices/d1/people')) return people.clone();
    if (url.startsWith('/api/devices')) {
      return Response.json([{ id: 'd1', name: 'Marcador de la entrada', status: 'ONLINE' }]);
    }
    if (url.startsWith('/api/work-schedules')) {
      return Response.json([
        { id: 's0', name: 'Administrativo L-V' },
        { id: 's1', name: 'Jornada de la empresa' },
      ]);
    }
    return new Response(null, { status: 404 });
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ImportFromDeviceCard onDone={() => {}} />
    </QueryClientProvider>,
  );
}
const imported = () => {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
  return call && JSON.parse(String(call[1]?.body));
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-12T15:00:00Z'));
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ImportFromDeviceCard', () => {
  it('proposes names from the terminal, lets HR fix them and imports only the new ones', async () => {
    renderCard();
    await screen.findByRole('option', { name: 'Marcador de la entrada' });
    await userEvent.click(screen.getByRole('button', { name: 'Leer el marcador' }));

    const form = screen.getByRole('form', { name: 'Importar del marcador' });
    expect(
      await within(form).findByLabelText('Nombres de MELANIE ANDREA ZAMBRANO PÉREZ'),
    ).toHaveValue('Melanie Andrea');
    expect(within(form).getByLabelText('Apellidos de MELANIE ANDREA ZAMBRANO PÉREZ')).toHaveValue(
      'Zambrano Pérez',
    );
    // Already an employee: shown, not importable.
    expect(within(form).getByLabelText('Importar a ANA RUIZ')).toBeDisabled();
    expect(within(form).getByText(/Ya registrada: Ana Ruiz · EMP-001/)).toBeVisible();

    // A single word cannot be split: the surname is missing until HR writes it.
    const importButton = within(form).getByRole('button', { name: 'Importar 2 personas' });
    expect(importButton).toBeDisabled();
    expect(within(form).getByText('Falta el nombre o el apellido de 1 persona.')).toBeVisible();
    await userEvent.type(within(form).getByLabelText('Apellidos de PEDRO'), 'Alcívar');
    await userEvent.click(importButton);

    await waitFor(() =>
      expect(imported()).toEqual({
        hireDate: '2026-11-01',
        scheduleId: 's1',
        people: [
          { biometricId: '12', firstName: 'Melanie Andrea', lastName: 'Zambrano Pérez' },
          { biometricId: '13', firstName: 'Pedro', lastName: 'Alcívar' },
        ],
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Se crearon 2 empleados. Complete la cédula de cada uno en su ficha',
    );
  });

  it('leaves out whoever is unticked', async () => {
    renderCard();
    await screen.findByRole('option', { name: 'Marcador de la entrada' });
    await userEvent.click(screen.getByRole('button', { name: 'Leer el marcador' }));
    await userEvent.click(await screen.findByLabelText('Importar a PEDRO'));
    expect(screen.getByRole('button', { name: 'Importar 1 persona' })).toBeEnabled();
  });

  it('says why the terminal could not be read', async () => {
    renderCard(
      Response.json(
        {
          statusCode: 409,
          code: 'DEVICE_READ_FAILED',
          params: { reason: 'CONNECTION_FAILED: Device is unreachable' },
        },
        { status: 409 },
      ),
    );
    await screen.findByRole('option', { name: 'Marcador de la entrada' });
    await userEvent.click(screen.getByRole('button', { name: 'Leer el marcador' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No se pudo leer el marcador:');
  });
});
