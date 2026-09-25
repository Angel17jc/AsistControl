import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmployeeRow } from '../../lib/types';
import { useAuth } from '../../stores/auth';
import { EmployeeForm } from './EmployeeForm';

const fetchMock = vi.fn<typeof fetch>();

const LUIS: EmployeeRow = {
  id: 'e3',
  employeeCode: 'EMP-0003',
  identification: '0900000003',
  firstName: 'Luis',
  lastName: 'Mendoza',
  email: 'luis@empresa.local',
  phone: null,
  hireDate: '2025-01-06',
  terminatedAt: '2026-06-30',
  status: 'INACTIVE',
  biometricId: '1003',
  department: { id: 'd1', name: 'Operaciones' },
  position: null,
  contractType: null,
  supervisor: { id: 'e2', firstName: 'María', lastName: 'Vera' },
};

function renderForm(employee?: EmployeeRow) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method && init.method !== 'GET') return Response.json({ id: 'x' });
    if (url === '/api/departments') return Response.json([{ id: 'd1', name: 'Operaciones' }]);
    if (url.startsWith('/api/employees')) {
      return Response.json({
        data: [{ ...LUIS, id: 'e2', firstName: 'María', lastName: 'Vera' }, LUIS],
        meta: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
      });
    }
    return Response.json([]);
  });
  const onDone = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <EmployeeForm employee={employee} onDone={onDone} />
    </QueryClientProvider>,
  );
  return onDone;
}

const sent = (method: string) => {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === method);
  return call && { url: String(call[0]), body: JSON.parse(String(call[1]?.body)) };
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  useAuth.setState({ status: 'authenticated', accessToken: 'token' });
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('EmployeeForm when editing', () => {
  it('starts from the employee as they are', async () => {
    renderForm(LUIS);
    expect(screen.getByRole('form', { name: 'Editar Luis Mendoza' })).toBeVisible();
    expect(screen.getByLabelText('Nombres')).toHaveValue('Luis');
    expect(screen.getByLabelText('Estado')).toHaveValue('INACTIVE');
    expect(screen.getByLabelText('Fecha de baja')).toHaveValue('2026-06-30');
    await screen.findByRole('option', { name: 'Vera María' });
    expect(screen.getByLabelText('Supervisor')).toHaveValue('e2');
  });

  it('never offers the employee as their own supervisor', async () => {
    renderForm(LUIS);
    await screen.findByRole('option', { name: 'Vera María' });
    expect(screen.queryByRole('option', { name: 'Mendoza Luis' })).toBeNull();
  });

  it('sends cleared optional fields as null', async () => {
    const onDone = renderForm(LUIS);
    await userEvent.clear(screen.getByLabelText('Correo'));
    await userEvent.clear(screen.getByLabelText('ID biométrico'));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());

    expect(sent('PATCH')).toMatchObject({
      url: '/api/employees/e3',
      body: { email: null, biometricId: null, phone: null, departmentId: 'd1' },
    });
  });

  it('clears the termination date when the employee is reactivated', async () => {
    const onDone = renderForm(LUIS);
    await userEvent.selectOptions(screen.getByLabelText('Estado'), 'ACTIVE');
    expect(screen.getByLabelText('Fecha de baja')).toHaveValue('');
    expect(screen.getByLabelText('Fecha de baja')).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sent('PATCH')?.body).toMatchObject({ status: 'ACTIVE', terminatedAt: null });
  });
});

describe('EmployeeForm when creating', () => {
  it('asks for no status and leaves empty fields out', async () => {
    const onDone = renderForm();
    expect(screen.queryByLabelText('Estado')).toBeNull();
    await userEvent.type(screen.getByLabelText('Código interno'), 'EMP-0099');
    await userEvent.type(screen.getByLabelText('Identificación'), '0900000099');
    await userEvent.type(screen.getByLabelText('Nombres'), 'Nuevo');
    await userEvent.type(screen.getByLabelText('Apellidos'), 'Ingreso');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());

    const body = sent('POST')?.body;
    expect(body).toMatchObject({ employeeCode: 'EMP-0099', firstName: 'Nuevo' });
    for (const key of ['email', 'status', 'terminatedAt']) expect(body).not.toHaveProperty(key);
  });
});
