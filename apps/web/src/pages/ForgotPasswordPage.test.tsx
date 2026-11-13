import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ForgotPasswordPage } from './ForgotPasswordPage';

const fetchMock = vi.fn<typeof fetch>();

function renderPage(passwordLinks = true) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith('/api/auth/options')) return Response.json({ passwordLinks });
    if (url.startsWith('/api/auth/forgot-password')) return new Response(null, { status: 202 });
    return new Response(null, { status: 404 });
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const sent = () =>
  fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/auth/forgot-password'));

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('ForgotPasswordPage', () => {
  it('asks for the link and answers the same whether or not the address has an account', async () => {
    renderPage();
    const email = await screen.findByLabelText('Correo electrónico');
    await userEvent.type(email, '  Melanie@Empresa.com ');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(
      'Si hay una cuenta con Melanie@Empresa.com, le llegará un correo',
    );
    expect(status).toHaveTextContent('vale 30 minutos');
    const [, init] = sent()[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ email: 'Melanie@Empresa.com' });
    expect(screen.getByRole('link', { name: 'Volver a iniciar sesión' })).toHaveAttribute(
      'href',
      '/login',
    );
  });

  it('points at a mistyped address before sending', async () => {
    renderPage();
    await userEvent.type(await screen.findByLabelText('Correo electrónico'), 'melanie@empresa');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }));
    expect(screen.getByLabelText('Correo electrónico')).toHaveAccessibleDescription(
      'Revise el correo: debe tener la forma nombre@empresa.com.',
    );
    expect(sent()).toHaveLength(0);
  });

  it('sends people to an administrator when the server cannot email links', async () => {
    renderPage(false);
    expect(await screen.findByText(/la contraseña la restablece un administrador/)).toBeVisible();
    expect(screen.queryByRole('form')).toBeNull();
  });
});
