import type { EmployeeStatus, PaginatedResponse } from '@asistcontrol/shared';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Palmtree, Pencil, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { EMPLOYEE_STATUS_LABEL, EmployeeForm } from '../components/employees/EmployeeForm';
import { EmployeeScheduleCard } from '../components/schedules/EmployeeScheduleCard';
import {
  Button,
  Card,
  ErrorState,
  Input,
  PageHeader,
  Pagination,
  Spinner,
  StatusBadge,
  Table,
  Td,
  type Tone,
} from '../components/ui';
import { VacationBalanceCard } from '../components/vacations/VacationBalanceCard';
import { api } from '../lib/api';
import type { EmployeeRow } from '../lib/types';
import { useAuth } from '../stores/auth';

const STATUS_TONE: Record<EmployeeStatus, Tone> = {
  ACTIVE: 'good',
  INACTIVE: 'neutral',
  SUSPENDED: 'warning',
};

export function EmployeesPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<EmployeeRow | null>(null);
  const [vacationsOf, setVacationsOf] = useState<EmployeeRow | null>(null);
  const [scheduleOf, setScheduleOf] = useState<EmployeeRow | null>(null);
  const canWrite = useAuth((s) => s.can('employees:write'));
  const canReadLeave = useAuth((s) => s.can('leave:read'));
  const canReadSchedules = useAuth((s) => s.can('schedules:read'));
  const canWriteSchedules = useAuth((s) => s.can('schedules:write'));
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
      {editing && (
        <EmployeeForm key={editing.id} employee={editing} onDone={() => setEditing(null)} />
      )}
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
      {scheduleOf && (
        <div className="mb-6">
          <EmployeeScheduleCard
            key={scheduleOf.id}
            employeeId={scheduleOf.id}
            title={`Horario de ${scheduleOf.firstName} ${scheduleOf.lastName}`}
            manage={canWriteSchedules}
          />
          <Button variant="ghost" className="mt-2" onClick={() => setScheduleOf(null)}>
            Cerrar horario
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
                    <StatusBadge tone={STATUS_TONE[e.status]}>
                      {EMPLOYEE_STATUS_LABEL[e.status]}
                    </StatusBadge>
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      {canWrite && (
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-xs"
                          icon={<Pencil className="size-3.5" />}
                          aria-label={`Editar ${e.firstName} ${e.lastName}`}
                          onClick={() => (setCreating(false), setEditing(e))}
                        >
                          Editar
                        </Button>
                      )}
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
                      {canReadSchedules && (
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-xs"
                          icon={<CalendarClock className="size-3.5" />}
                          aria-label={`Horario de ${e.firstName} ${e.lastName}`}
                          onClick={() => setScheduleOf(e)}
                        >
                          Horario
                        </Button>
                      )}
                    </div>
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
