import type { AppNotification, NotificationType } from '@asistcontrol/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../stores/auth';
import { NotificationBell } from './NotificationBell';

const fetchMock = vi.fn<typeof fetch>();

const NOTIFICATIONS: AppNotification[] = [
  {
    id: 'n1',
    type: 'DEVICE_DOWN',
    data: { deviceName: 'Bodega', status: 'OFFLINE', error: 'CONNECTION_FAILED: ECONNREFUSED' },
    entity: 'Device',
    entityId: 'd1',
    readAt: null,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'n2',
    type: 'DEVICE_RECOVERED',
    data: { deviceName: 'Entrada' },
    entity: 'Device',
    entityId: 'd2',
    readAt: '2026-09-23T10:00:00.000Z',
    createdAt: '2026-09-23T09:00:00.000Z',
  },
];

interface Preferences {
  emailNotifications: boolean;
  emailAvailable: boolean;
  emailTypes: { type: NotificationType; enabled: boolean }[];
}

/** A supervisor's choices: they review and request leave, and never hear about devices. */
const SUPERVISOR_TYPES: Preferences['emailTypes'] = [
  { type: 'LEAVE_REQUESTED', enabled: true },
  { type: 'LEAVE_REVIEWED', enabled: true },
  { type: 'VACATION_EXPIRING', enabled: true },
];

function renderBell(unread = 1, preferences?: Omit<Preferences, 'emailTypes'>) {
  let current: Preferences | undefined = preferences && {
    ...preferences,
    emailTypes: SUPERVISOR_TYPES,
  };
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === '/api/notifications/preferences') {
      if (init?.method === 'PATCH' && current) {
        // Like the API: a switch, or a list of muted types that replaces the previous one.
        const change = JSON.parse(String(init.body)) as {
          emailNotifications?: boolean;
          mutedTypes?: NotificationType[];
        };
        current = {
          ...current,
          emailNotifications: change.emailNotifications ?? current.emailNotifications,
          emailTypes: change.mutedTypes
            ? current.emailTypes.map((t) => ({
                ...t,
                enabled: !change.mutedTypes!.includes(t.type),
              }))
            : current.emailTypes,
        };
        return Response.json(current);
      }
      return current ? Response.json(current) : new Response(null, { status: 404 });
    }
    if (url.startsWith('/api/notifications/unread-count')) return Response.json({ count: unread });
    if (url.startsWith('/api/notifications?')) {
      return Response.json({ data: NOTIFICATIONS, total: 2, page: 1, pageSize: 20 });
    }
    if (init?.method === 'POST') {
      return url.endsWith('/read') ? new Response(null, { status: 204 }) : Response.json({});
    }
    return new Response(null, { status: 404 });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <NotificationBell />
        <Routes>
          <Route path="/" element={<p>Inicio</p>} />
          <Route path="/dispositivos" element={<p>Página de dispositivos</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const posts = () =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url]) => String(url));

const openBell = async () =>
  userEvent.click(await screen.findByRole('button', { name: /^Notificaciones/ }));

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  useAuth.setState({ status: 'authenticated', accessToken: 'token' });
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('NotificationBell', () => {
  it('announces how many are unread', async () => {
    renderBell(3);
    expect(await screen.findByRole('button', { name: 'Notificaciones, 3 sin leer' })).toBeVisible();
  });

  it('shows no count when everything is read', async () => {
    renderBell(0);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: 'Notificaciones' })).toBeVisible();
  });

  it('lists the latest, telling unread from read', async () => {
    renderBell();
    await openBell();
    const panel = screen.getByRole('dialog', { name: 'Notificaciones' });

    expect(await screen.findByText('Dispositivo sin conexión')).toBeVisible();
    expect(screen.getByText(/^Bodega: Sin respuesta del equipo/)).toBeVisible();
    expect(screen.getByText('Dispositivo en línea de nuevo')).toBeVisible();
    // Only the unread one is announced as such to screen readers.
    expect(panel.querySelectorAll('.sr-only')).toHaveLength(1);
  });

  it('opens the page of a notification and marks it read', async () => {
    renderBell();
    await openBell();
    await userEvent.click(await screen.findByText('Dispositivo sin conexión'));

    expect(await screen.findByText('Página de dispositivos')).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(posts()).toContain('/api/notifications/n1/read'));
  });

  it('does not mark again one already read', async () => {
    renderBell();
    await openBell();
    await userEvent.click(await screen.findByText('Dispositivo en línea de nuevo'));
    await screen.findByText('Página de dispositivos');
    expect(posts()).toEqual([]);
  });

  it('marks all as read, and closes with Escape', async () => {
    renderBell();
    await openBell();
    await userEvent.click(await screen.findByRole('button', { name: 'Marcar todas como leídas' }));
    await waitFor(() => expect(posts()).toContain('/api/notifications/read-all'));

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lets people turn email notifications off', async () => {
    renderBell(0, { emailNotifications: true, emailAvailable: true });
    await openBell();
    const toggle = await screen.findByRole('checkbox', { name: 'Recibir también por correo' });
    expect(toggle).toBeChecked();

    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ emailNotifications: false });
  });

  it('offers no email choice while the server cannot send email', async () => {
    renderBell(0, { emailNotifications: true, emailAvailable: false });
    await openBell();
    // The list renders from the same kind of response: once it is there, so is the answer.
    await screen.findByText('Dispositivo sin conexión');
    await waitFor(() =>
      expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(
        '/api/notifications/preferences',
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('checkbox', { name: 'Recibir también por correo' })).toBeNull();
  });

  it('lets people choose which kinds arrive by email', async () => {
    renderBell(0, { emailNotifications: true, emailAvailable: true });
    await openBell();
    const kinds = await screen.findByRole('group', { name: 'Qué avisos recibir por correo' });
    // Only what a supervisor can receive: nothing about devices.
    expect(
      within(kinds)
        .getAllByRole('checkbox')
        .map((c) => c.closest('label')!.textContent),
    ).toEqual([
      'Solicitudes por revisar',
      'Solicitudes aprobadas o rechazadas',
      'Vacaciones por caducar',
    ]);

    const reviewed = within(kinds).getByRole('checkbox', {
      name: 'Solicitudes aprobadas o rechazadas',
    });
    await userEvent.click(reviewed);
    await waitFor(() => expect(reviewed).not.toBeChecked());
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ mutedTypes: ['LEAVE_REVIEWED'] });
  });

  it('hides the kinds while email is off altogether', async () => {
    renderBell(0, { emailNotifications: false, emailAvailable: true });
    await openBell();
    await screen.findByRole('checkbox', { name: 'Recibir también por correo' });
    expect(screen.queryByRole('group', { name: 'Qué avisos recibir por correo' })).toBeNull();
  });
});
