import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../stores/auth';
import { ReportsPage } from './ReportsPage';

const fetchMock = vi.fn<typeof fetch>();
const ROW = {
  fecha: '2026-10-05',
  empleado: 'Vera Ana',
  entrada: '09:00',
  salida_almuerzo: '13:00',
};

function renderPage({ overtimeEnabled = true, total = 1 } = {}) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith('/api/settings/features')) return Response.json({ overtimeEnabled });
    if (url.startsWith('/api/reports/')) {
      if (url.includes('format=')) return new Response(new Blob(['file']));
      return Response.json({ total, rows: total ? [ROW] : [] });
    }
    return new Response(null, { status: 404 });
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ReportsPage />
    </QueryClientProvider>,
  );
}

const requested = () => fetchMock.mock.calls.map(([input]) => String(input));

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL() {} }),
  );
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-04T15:00:00Z'));
  useAuth.setState({ status: 'authenticated', accessToken: 'token' });
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ReportsPage', () => {
  it('opens on the attendance of the current month', async () => {
    renderPage();
    await screen.findByText('Vera Ana');
    expect(screen.getByLabelText('Reporte')).toHaveValue('attendance');
    expect(screen.getByLabelText('Mes')).toHaveValue('2026-11-01');
    expect(requested().find((u) => u.startsWith('/api/reports/'))).toContain(
      '/api/reports/attendance?from=2026-11-01',
    );
  });

  it('lets choose a past month by its name', async () => {
    renderPage();
    await screen.findByText('Vera Ana');
    const months = screen.getByLabelText('Mes');
    expect(within(months).getByRole('option', { name: /octubre de 2026/ })).toBeInTheDocument();
    await userEvent.selectOptions(months, '2026-10-01');
    await waitFor(() =>
      expect(requested().some((u) => u.includes('attendance?from=2026-10-01'))).toBe(true),
    );
  });

  it('downloads the month in Excel and in PDF', async () => {
    renderPage();
    await screen.findByText('Vera Ana');
    await userEvent.click(screen.getByRole('button', { name: 'Descargar Excel' }));
    await waitFor(() => expect(requested().some((u) => u.includes('format=xlsx'))).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'Descargar PDF' }));
    await waitFor(() => expect(requested().some((u) => u.includes('format=pdf'))).toBe(true));
  });

  it('offers the PDF only for the month of attendance, and dates for the other reports', async () => {
    renderPage();
    await screen.findByText('Vera Ana');
    await userEvent.selectOptions(screen.getByLabelText('Reporte'), 'daily');
    expect(screen.queryByRole('button', { name: 'Descargar PDF' })).toBeNull();
    expect(screen.queryByLabelText('Mes')).toBeNull();
    expect(screen.getByLabelText('Desde')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargar Excel' })).toBeInTheDocument();
  });

  it('does not offer overtime to a company that does not pay it', async () => {
    renderPage({ overtimeEnabled: false });
    await screen.findByText('Vera Ana');
    await waitFor(() =>
      expect(
        within(screen.getByLabelText('Reporte')).queryByRole('option', { name: 'Horas extra' }),
      ).toBeNull(),
    );
  });

  it('has nothing to download from an empty report', async () => {
    renderPage({ total: 0 });
    await screen.findByText(/0 filas/);
    expect(screen.getByRole('button', { name: 'Descargar Excel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Descargar PDF' })).toBeDisabled();
  });
});
