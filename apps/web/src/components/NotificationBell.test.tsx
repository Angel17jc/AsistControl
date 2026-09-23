import type { AppNotification } from '@asistcontrol/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
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

function renderBell(unread = 1) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
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
});
