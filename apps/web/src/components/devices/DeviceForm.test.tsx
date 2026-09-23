import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { explainDeviceError } from '../../lib/device-drivers';
import { useAuth } from '../../stores/auth';
import { DeviceForm } from './DeviceForm';

const fetchMock = vi.fn<typeof fetch>();

function renderForm(onDone = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DeviceForm onDone={onDone} />
    </QueryClientProvider>,
  );
  return onDone;
}

/** Body of the POST /devices the form sent. */
function sentDevice(): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(
    ([url, init]) => url === '/api/devices' && init?.method === 'POST',
  );
  return JSON.parse(String(call?.[1]?.body));
}

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
