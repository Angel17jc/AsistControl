import type { EmployeeStatus, PaginatedResponse } from '@asistcontrol/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Palmtree, Plus, Search } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Pagination,
  Select,
  Spinner,
  StatusBadge,
  Table,
  Td,
  type Tone,
} from '../components/ui';
import { VacationBalanceCard } from '../components/vacations/VacationBalanceCard';
import { api } from '../lib/api';
import type { ContractTypeRow, EmployeeRow, NamedRef } from '../lib/types';
import { useAuth } from '../stores/auth';

const STATUS: Record<EmployeeStatus, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Activo', tone: 'good' },
  INACTIVE: { label: 'Inactivo', tone: 'neutral' },
  SUSPENDED: { label: 'Suspendido', tone: 'warning' },
};

export function EmployeesPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [vacationsOf, setVacationsOf] = useState<EmployeeRow | null>(null);
  const canWrite = useAuth((s) => s.can('employees:write'));
  const canReadLeave = useAuth((s) => s.can('leave:read'));
  const { data, isLoading, error } = useQuery({
    queryKey: ['employees', search, page],
    queryFn: () =>
      api<PaginatedResponse<EmployeeRow>>('/employees', { query: { search, page, pageSize: 20 } }),
  });

  return (
    <>
      <PageHeader
        title="Empleados"
        description="Nómina de personal y su identificador biométrico"
        actions={
          canWrite && (
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              onClick={() => setCreating(true)}
            >
              Nuevo empleado
            </Button>
          )
        }
      />
      {creating && <EmployeeForm onDone={() => setCreating(false)} />}
      {vacationsOf && (
        <div className="mb-6">
          <VacationBalanceCard
            key={vacationsOf.id}
            employeeId={vacationsOf.id}
            title={`Vacaciones de ${vacationsOf.firstName} ${vacationsOf.lastName}`}
            manage={canWrite}
          />
          <Button variant="ghost" className="mt-2" onClick={() => setVacationsOf(null)}>
            Cerrar vacaciones
          </Button>
        </div>
      )}
      <Card>
        <div className="border-b border-line px-4 py-3">
          <div className="relative max-w-sm">
            <Search
              className="pointer-events-none absolute left-3 top-2.5 size-4 text-ink-3"
              aria-hidden
            />
            <Input
              aria-label="Buscar empleado"
              placeholder="Buscar por nombre, código o identificación"
              className="w-full pl-9"
              value={search}
              onChange={(e) => (setSearch(e.target.value), setPage(1))}
            />
          </div>
        </div>
        {isLoading && <Spinner />}
        {error && <ErrorState error={error} />}
        {data && (
          <>
            <Table
              head={[
                'Código',
                'Empleado',
                'Departamento',
                'Cargo',
                'Supervisor',
                'Contrato',
                'ID biométrico',
                'Estado',
                '',
              ]}
              empty={data.data.length === 0}
            >
              {data.data.map((e) => (
                <tr key={e.id}>
                  <Td className="tabular text-ink-2">{e.employeeCode}</Td>
                  <Td>
                    <p className="font-medium">
                      {e.lastName} {e.firstName}
                    </p>
                    <p className="text-xs text-ink-3">{e.email ?? e.identification}</p>
                  </Td>
                  <Td className="text-ink-2">{e.department?.name ?? '—'}</Td>
                  <Td className="text-ink-2">{e.position?.name ?? '—'}</Td>
                  <Td className="text-ink-2">
                    {e.supervisor ? `${e.supervisor.firstName} ${e.supervisor.lastName}` : '—'}
                  </Td>
                  <Td className="text-ink-2">{e.contractType?.name ?? '—'}</Td>
                  <Td className="tabular">
                    {e.biometricId ?? <span className="text-ink-3">sin enrolar</span>}
                  </Td>
                  <Td>
                    <StatusBadge tone={STATUS[e.status].tone}>{STATUS[e.status].label}</StatusBadge>
                  </Td>
                  <Td>
                    {canReadLeave && (
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs"
                        icon={<Palmtree className="size-3.5" />}
                        aria-label={`Vacaciones de ${e.firstName} ${e.lastName}`}
                        onClick={() => setVacationsOf(e)}
                      >
                        Vacaciones
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
            <Pagination
              page={data.meta.page}
              totalPages={data.meta.totalPages}
              onChange={setPage}
            />
          </>
        )}
      </Card>
    </>
  );
}

function EmployeeForm({ onDone }: { onDone: () => void }) {
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
  const [form, setForm] = useState({
    employeeCode: '',
    identification: '',
    firstName: '',
    lastName: '',
    email: '',
    hireDate: new Date().toISOString().slice(0, 10),
    departmentId: '',
    positionId: '',
    contractTypeId: '',
    biometricId: '',
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const create = useMutation({
    // Empty optional fields are omitted so the API validation does not reject them.
    mutationFn: () =>
      api('/employees', {
        method: 'POST',
        body: Object.fromEntries(Object.entries(form).filter(([, v]) => v !== '')),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      onDone();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Card className="mb-6">
      <form onSubmit={submit} className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Código interno">
          <Input
            required
            placeholder="EMP-0011"
            value={form.employeeCode}
            onChange={set('employeeCode')}
          />
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
        <Field label="ID biométrico" hint="El mismo número enrolado en los marcadores">
          <Input value={form.biometricId} onChange={set('biometricId')} />
        </Field>
        <div className="flex items-end gap-2 lg:col-span-2">
          <Button type="submit" variant="primary" loading={create.isPending}>
            Guardar
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancelar
          </Button>
          {create.error && (
            <p role="alert" className="text-sm text-critical">
              {create.error.message}
            </p>
          )}
        </div>
      </form>
    </Card>
  );
}
