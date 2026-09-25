import {
  EMPLOYEE_STATUSES,
  type EmployeeStatus,
  type PaginatedResponse,
} from '@asistcontrol/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '../../lib/api';
import type { ContractTypeRow, EmployeeRow, NamedRef } from '../../lib/types';
import { Button, Card, Field, Input, Select } from '../ui';

export const EMPLOYEE_STATUS_LABEL: Record<EmployeeStatus, string> = {
  ACTIVE: 'Activo',
  INACTIVE: 'Inactivo',
  SUSPENDED: 'Suspendido',
};

/** Optional fields: an empty input means "none", which the API receives as null. */
const OPTIONAL = [
  'email',
  'phone',
  'departmentId',
  'positionId',
  'contractTypeId',
  'supervisorId',
  'biometricId',
  'terminatedAt',
] as const;

/**
 * Registers an employee, or edits one when `employee` is given. Editing also covers status
 * and termination; reactivating someone clears their termination date, which the API needs
 * to resume things like vacation accrual.
 */
export function EmployeeForm({ employee, onDone }: { employee?: EmployeeRow; onDone: () => void }) {
  const editing = employee !== undefined;
  const queryClient = useQueryClient();
  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: () => api<NamedRef[]>('/departments'),
  });
  const positions = useQuery({
    queryKey: ['positions'],
    queryFn: () => api<NamedRef[]>('/positions'),
  });
  const contractTypes = useQuery({
    queryKey: ['contract-types'],
    queryFn: () => api<ContractTypeRow[]>('/contract-types'),
  });
  // Known limit: the API pages at 100, enough for the supervisor list of a mid-size company.
  const supervisors = useQuery({
    queryKey: ['employees', 'supervisor-options'],
    queryFn: () =>
      api<PaginatedResponse<EmployeeRow>>('/employees', {
        query: { status: 'ACTIVE', pageSize: 100 },
      }),
  });

  const [form, setForm] = useState({
    employeeCode: employee?.employeeCode ?? '',
    identification: employee?.identification ?? '',
    firstName: employee?.firstName ?? '',
    lastName: employee?.lastName ?? '',
    email: employee?.email ?? '',
    phone: employee?.phone ?? '',
    hireDate: employee?.hireDate ?? new Date().toISOString().slice(0, 10),
    departmentId: employee?.department?.id ?? '',
    positionId: employee?.position?.id ?? '',
    contractTypeId: employee?.contractType?.id ?? '',
    supervisorId: employee?.supervisor?.id ?? '',
    biometricId: employee?.biometricId ?? '',
    status: (employee?.status ?? 'ACTIVE') as EmployeeStatus,
    terminatedAt: employee?.terminatedAt ?? '',
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  function changeStatus(status: EmployeeStatus) {
    // Back to active: the termination no longer applies.
    setForm((f) => ({ ...f, status, terminatedAt: status === 'ACTIVE' ? '' : f.terminatedAt }));
  }

  const save = useMutation({
    mutationFn: () => {
      if (!editing) {
        // Creating: leave out what was not filled in (and the edit-only fields).
        const { status: _status, terminatedAt: _terminatedAt, ...fields } = form;
        return api('/employees', {
          method: 'POST',
          body: Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== '')),
        });
      }
      const body: Record<string, string | null> = { ...form };
      for (const key of OPTIONAL) if (body[key] === '') body[key] = null;
      return api(`/employees/${employee.id}`, { method: 'PATCH', body });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['employees'] }),
        queryClient.invalidateQueries({ queryKey: ['vacation-balance'] }),
      ]);
      onDone();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  const fullName = employee ? `${employee.firstName} ${employee.lastName}` : '';

  return (
    <Card className="mb-6">
      <form
        onSubmit={submit}
        aria-label={editing ? `Editar ${fullName}` : 'Nuevo empleado'}
        className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4"
      >
        <Field label="Código interno">
          <Input required value={form.employeeCode} onChange={set('employeeCode')} />
        </Field>
        <Field label="Identificación">
          <Input required value={form.identification} onChange={set('identification')} />
        </Field>
        <Field label="Nombres">
          <Input required value={form.firstName} onChange={set('firstName')} />
        </Field>
        <Field label="Apellidos">
          <Input required value={form.lastName} onChange={set('lastName')} />
        </Field>
        <Field label="Correo">
          <Input type="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Teléfono">
          <Input type="tel" value={form.phone} onChange={set('phone')} />
        </Field>
        <Field label="Fecha de ingreso">
          <Input type="date" required value={form.hireDate} onChange={set('hireDate')} />
        </Field>
        <Field label="Departamento">
          <Select value={form.departmentId} onChange={set('departmentId')}>
            <option value="">—</option>
            {departments.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Cargo">
          <Select value={form.positionId} onChange={set('positionId')}>
            <option value="">—</option>
            {positions.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Supervisor">
          <Select value={form.supervisorId} onChange={set('supervisorId')}>
            <option value="">—</option>
            {supervisors.data?.data
              // Nobody supervises themselves (the API refuses it too).
              .filter((s) => s.id !== employee?.id)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.lastName} {s.firstName}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Tipo de contrato" hint="Decide sus vacaciones">
          <Select value={form.contractTypeId} onChange={set('contractTypeId')}>
            <option value="">—</option>
            {contractTypes.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="ID biométrico"
          hint={
            editing
              ? 'Las marcaciones sin empleado con este ID se le asignarán'
              : 'El mismo número enrolado en los marcadores'
          }
        >
          <Input value={form.biometricId} onChange={set('biometricId')} />
        </Field>
        {editing && (
          <>
            <Field label="Estado">
              <Select
                value={form.status}
                onChange={(e) => changeStatus(e.target.value as EmployeeStatus)}
              >
                {EMPLOYEE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {EMPLOYEE_STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Fecha de baja"
              hint={
                form.status === 'ACTIVE' ? 'Solo si deja de estar activo' : 'Último día trabajado'
              }
            >
              <Input
                type="date"
                value={form.terminatedAt}
                disabled={form.status === 'ACTIVE'}
                min={form.hireDate}
                onChange={set('terminatedAt')}
              />
            </Field>
          </>
        )}
        <div className="flex items-end gap-2 sm:col-span-2">
          <Button type="submit" variant="primary" loading={save.isPending}>
            {editing ? 'Guardar cambios' : 'Guardar'}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancelar
          </Button>
        </div>
        {save.error && (
          <p role="alert" className="text-sm text-critical sm:col-span-2 lg:col-span-4">
            {save.error.message}
          </p>
        )}
      </form>
    </Card>
  );
}
