import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { explainDeviceError } from '../../lib/device-drivers';
import type { DeviceRow } from '../../lib/types';
import { useAuth } from '../../stores/auth';
import { DeviceForm } from './DeviceForm';

const fetchMock = vi.fn<typeof fetch>();

function renderForm(onDone = vi.fn(), device?: DeviceRow) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DeviceForm onDone={onDone} device={device} />
    </QueryClientProvider>,
  );
  return onDone;
}

/** Body of the POST /devices (or PATCH /devices/:id) the form sent. */
function sentDevice(method = 'POST'): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(
    ([url, init]) => String(url).startsWith('/api/devices') && init?.method === method,
  );
  return JSON.parse(String(call?.[1]?.body));
}

const HIKVISION: DeviceRow = {
  id: 'dev-1',
  name: 'Acceso principal',
  driver: 'HIKVISION',
  manufacturer: 'Hikvision',
  model: 'DS-K1T671M',
  serialNumber: 'DS-1',
  host: '192.168.1.64',
  port: 443,
  location: 'Recepción',
  status: 'ONLINE',
  config: { realtime: true, protocol: 'https' },
  lastSyncAt: null,
  lastSeenAt: null,
  lastError: null,
  hasCredentials: true,
  registeredAt: '2026-09-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  useAuth.setState({ status: 'authenticated', accessToken: 'token' });
  fetchMock.mockImplementation(async (url) =>
    url === '/api/devices/drivers'
      ? Response.json(['MOCK', 'ZKTECO', 'HIKVISION'])
      : Response.json({ id: 'd1' }, { status: 201 }),
  );
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

async function chooseDriver(driver: string) {
  await screen.findByRole('option', { name: driver });
  await userEvent.selectOptions(screen.getByLabelText('Driver'), driver);
}

describe('DeviceForm', () => {
  it('asks for no credentials for the simulator', async () => {
    renderForm();
    await screen.findByRole('option', { name: 'HIKVISION' });
    expect(screen.queryByLabelText(/Usuario|Contraseña|Clave/)).toBeNull();
  });

  it('fills in Hikvision defaults and asks for the ISAPI user', async () => {
    renderForm();
    await chooseDriver('HIKVISION');

    expect(screen.getByLabelText('Fabricante')).toHaveValue('Hikvision');
    expect(screen.getByLabelText('Puerto')).toHaveValue(80);
    const user = screen.getByLabelText('Usuario ISAPI');
    expect(user).toBeRequired();
    // The advice is the field's description, read after its name, not part of the name.
    expect(user).toHaveAccessibleName('Usuario ISAPI');
    expect(user).toHaveAccessibleDescription(
      'Mejor un usuario dedicado que el administrador del equipo',
    );
    const password = screen.getByLabelText('Contraseña ISAPI');
    expect(password).toBeRequired();
    expect(password).toHaveAttribute('type', 'password');
    // A terminal's password must not be offered to the password manager as the user's own.
    expect(password).toHaveAttribute('autocomplete', 'new-password');
  });

  it('sends the credentials and the transport of a Hikvision terminal', async () => {
    const onDone = renderForm();
    await chooseDriver('HIKVISION');
    await userEvent.type(screen.getByLabelText('Nombre'), 'Acceso principal');
    await userEvent.type(screen.getByLabelText('Usuario ISAPI'), 'asistencia');
    await userEvent.type(screen.getByLabelText('Contraseña ISAPI'), 's3creta!');
    await userEvent.selectOptions(screen.getByLabelText('Protocolo'), 'https');
    expect(screen.getByLabelText('Puerto')).toHaveValue(443);

    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());

    expect(sentDevice()).toMatchObject({
      name: 'Acceso principal',
      driver: 'HIKVISION',
      port: 443,
      config: { realtime: true, protocol: 'https' },
      credentials: { username: 'asistencia', password: 's3creta!' },
    });
  });

  it('keeps a custom port when switching protocol', async () => {
    renderForm();
    await chooseDriver('HIKVISION');
    await userEvent.clear(screen.getByLabelText('Puerto'));
    await userEvent.type(screen.getByLabelText('Puerto'), '8080');
    await userEvent.selectOptions(screen.getByLabelText('Protocolo'), 'https');
    expect(screen.getByLabelText('Puerto')).toHaveValue(8080);
  });

  it('omits an empty ZKTeco communication key', async () => {
    const onDone = renderForm();
    await chooseDriver('ZKTECO');
    expect(screen.getByLabelText('Clave de comunicación')).not.toBeRequired();
    expect(screen.queryByLabelText('Protocolo')).toBeNull();
    await userEvent.type(screen.getByLabelText('Nombre'), 'Bodega');

    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());

    const body = sentDevice();
    expect(body).toMatchObject({ driver: 'ZKTECO', port: 4370, config: { realtime: true } });
    expect(body).not.toHaveProperty('credentials');
    expect(body.config).not.toHaveProperty('protocol');
  });

  it('never carries a password over to another driver', async () => {
    const onDone = renderForm();
    await chooseDriver('HIKVISION');
    await userEvent.type(screen.getByLabelText('Contraseña ISAPI'), 'no-debe-viajar');
    await chooseDriver('ZKTECO');
    await userEvent.type(screen.getByLabelText('Nombre'), 'Bodega');

    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(JSON.stringify(sentDevice())).not.toContain('no-debe-viajar');
  });
});

describe('explainDeviceError', () => {
  it.each([
    [
      'AUTHENTICATION_FAILED: Device rejected the username or password',
      'El equipo rechazó las credenciales (Device rejected the username or password)',
    ],
    [
      'CONNECTION_FAILED: ECONNREFUSED',
      'Sin respuesta del equipo: revise la IP, el puerto y la red (ECONNREFUSED)',
    ],
    ['Algo raro', 'Algo raro'],
    [null, 'Error desconocido'],
  ])('%s', (error, expected) => {
    expect(explainDeviceError(error)).toBe(expected);
  });
});

describe('DeviceForm when editing', () => {
  const save = () => userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

  it('starts from the device as it is, with stored credentials optional', async () => {
    renderForm(vi.fn(), HIKVISION);
    expect(screen.getByLabelText('Nombre')).toHaveValue('Acceso principal');
    expect(screen.getByLabelText('Protocolo')).toHaveValue('https');
    expect(screen.getByLabelText('Puerto')).toHaveValue(443);
    expect(screen.getByLabelText('Activo: se sincroniza y recibe marcaciones')).toBeChecked();

    const password = screen.getByLabelText('Contraseña ISAPI');
    expect(password).not.toBeRequired();
    expect(password).toHaveValue('');
    expect(password).toHaveAccessibleDescription('Guardada. Déjela vacía para conservarla');
  });

  it('keeps the stored credentials when none are typed', async () => {
    const onDone = renderForm(vi.fn(), HIKVISION);
    await userEvent.clear(screen.getByLabelText('Ubicación'));
    await save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());

    const body = sentDevice('PATCH');
    expect(body).toMatchObject({ name: 'Acceso principal', location: null, enabled: true });
    expect(body).not.toHaveProperty('credentials');
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/devices/dev-1')).toBe(true);
  });

  it('replaces the password when a new one is typed', async () => {
    const onDone = renderForm(vi.fn(), HIKVISION);
    await userEvent.type(screen.getByLabelText('Usuario ISAPI'), 'asistencia');
    await userEvent.type(screen.getByLabelText('Contraseña ISAPI'), 'nueva-clave');
    await save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sentDevice('PATCH').credentials).toEqual({
      username: 'asistencia',
      password: 'nueva-clave',
    });
  });

  it('asks for every credential as soon as one is typed, so the user is never dropped', async () => {
    renderForm(vi.fn(), HIKVISION);
    expect(screen.getByLabelText('Usuario ISAPI')).not.toBeRequired();
    await userEvent.type(screen.getByLabelText('Contraseña ISAPI'), 'solo-la-clave');
    expect(screen.getByLabelText('Usuario ISAPI')).toBeRequired();
  });

  it('warns that another terminal means a full re-read', async () => {
    renderForm(vi.fn(), HIKVISION);
    expect(screen.queryByText(/leerá su memoria completa/)).toBeNull();
    await userEvent.clear(screen.getByLabelText('IP / host'));
    await userEvent.type(screen.getByLabelText('IP / host'), '192.168.1.65');
    expect(screen.getByText(/leerá su memoria completa/)).toBeInTheDocument();
  });

  it('asks for the new driver credentials when the driver changes', async () => {
    renderForm(vi.fn(), { ...HIKVISION, driver: 'ZKTECO', config: {}, port: 4370 });
    await chooseDriver('HIKVISION');
    expect(screen.getByLabelText('Contraseña ISAPI')).toBeRequired();
    expect(screen.getByText(/se descartarán las credenciales anteriores/)).toBeInTheDocument();
  });

  it('removes a stored communication key on request', async () => {
    const zk = { ...HIKVISION, driver: 'ZKTECO' as const, config: {}, port: 4370 };
    const onDone = renderForm(vi.fn(), zk);
    await userEvent.click(screen.getByLabelText('Quitar las credenciales guardadas'));
    expect(screen.getByLabelText('Clave de comunicación')).toBeDisabled();
    await save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sentDevice('PATCH').credentials).toBeNull();
  });

  it('does not offer to remove credentials a driver cannot work without', () => {
    renderForm(vi.fn(), HIKVISION);
    expect(screen.queryByLabelText('Quitar las credenciales guardadas')).toBeNull();
  });

  it('disables the terminal', async () => {
    const onDone = renderForm(vi.fn(), HIKVISION);
    await userEvent.click(screen.getByLabelText('Activo: se sincroniza y recibe marcaciones'));
    await save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sentDevice('PATCH').enabled).toBe(false);
  });
});
