import { ATTENDANCE_STATUSES, type PaginatedResponse } from '@asistcontrol/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { ATTENDANCE_STATUS } from '../components/status';
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
} from '../components/ui';
import { api } from '../lib/api';
import {
  ANOMALY_LABEL,
  PUNCH_LABEL,
  formatDate,
  formatDateTime,
  formatMinutes,
  formatTime,
  todayIso,
} from '../lib/format';
import type { AttendanceEventRow, AttendanceRecordRow, EmployeeRow } from '../lib/types';
import { useAuth } from '../stores/auth';

export function AttendancePage() {
  const [tab, setTab] = useState<'records' | 'events'>('records');
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const canWrite = useAuth((s) => s.can('attendance:write'));
  const [showManual, setShowManual] = useState(false);

  return (
    <>
      <PageHeader
        title="Asistencia"
        description="Jornadas calculadas a partir de las marcaciones de los dispositivos"
        actions={
          canWrite && (
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              onClick={() => setShowManual((v) => !v)}
            >
              Corrección manual
            </Button>
          )
        }
      />
      {showManual && <ManualEventForm onDone={() => setShowManual(false)} />}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex rounded-lg border border-line bg-surface-1 p-1" role="tablist">
          {(['records', 'events'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={clsx(
                'rounded-md px-3 py-1.5 text-sm',
                tab === t ? 'bg-surface-2 font-medium text-ink-1' : 'text-ink-2',
              )}
            >
              {t === 'records' ? 'Jornadas' : 'Marcaciones'}
            </button>
          ))}
        </div>
        <Field label="Desde">
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Hasta">
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      {tab === 'records' ? (
        <RecordsTable from={from} to={to} />
      ) : (
        <EventsTable from={from} to={to} />
      )}
    </>
  );
}

function RecordsTable({ from, to }: { from: string; to: string }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useQuery({
    queryKey: ['attendance', 'records', from, to, status, page],
    queryFn: () =>
      api<PaginatedResponse<AttendanceRecordRow>>('/attendance/records', {
        query: { from, to, status, page, pageSize: 25 },
      }),
  });

  return (
    <Card>
      <div className="flex justify-end border-b border-line px-4 py-3">
        <Select
          aria-label="Estado"
          className="w-48"
          value={status}
          onChange={(e) => (setStatus(e.target.value), setPage(1))}
        >
          <option value="">Todos los estados</option>
          {ATTENDANCE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ATTENDANCE_STATUS[s].label}
            </option>
          ))}
        </Select>
      </div>
      {isLoading && <Spinner />}
      {error && <ErrorState error={error} />}
      {data && (
        <>
          <Table
            head={[
              'Fecha',
              'Empleado',
              'Estado',
              'Horario',
              'Entrada',
              'Salida',
              'Trabajado',
              'Atraso',
              'Extra',
              'Novedades',
            ]}
            empty={data.data.length === 0}
          >
            {data.data.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap text-ink-2">{formatDate(r.workDate)}</Td>
                <Td>
                  <p className="font-medium">
                    {r.employee.lastName} {r.employee.firstName}
                  </p>
                  <p className="text-xs text-ink-3">
                    {r.employee.department?.name ?? r.employee.employeeCode}
                  </p>
                </Td>
                <Td>
                  <StatusBadge tone={ATTENDANCE_STATUS[r.status].tone}>
                    {ATTENDANCE_STATUS[r.status].label}
                  </StatusBadge>
                  {!r.isFinal && (
                    <p
                      className="mt-1 text-xs text-ink-3"
                      title="La ventana de la jornada aún no cierra; puede cambiar si llegan más marcaciones"
                    >
                      provisional
                    </p>
                  )}
                </Td>
                <Td className="tabular whitespace-nowrap text-ink-2">
                  {r.scheduledStart
                    ? `${formatTime(r.scheduledStart)}–${formatTime(r.scheduledEnd)}`
                    : '—'}
                </Td>
                <Td className="tabular">{formatTime(r.firstIn)}</Td>
                <Td className="tabular">{formatTime(r.lastOut)}</Td>
                <Td className="tabular whitespace-nowrap">{formatMinutes(r.workedMinutes)}</Td>
                <Td className="tabular">{r.lateMinutes > 0 ? `${r.lateMinutes} min` : '—'}</Td>
                <Td className="tabular">
                  {r.overtimeMinutes > 0 ? formatMinutes(r.overtimeMinutes) : '—'}
                </Td>
                <Td className="text-xs text-ink-2">
                  {r.anomalies.map((a) => ANOMALY_LABEL[a]).join(' · ') || '—'}
                </Td>
              </tr>
            ))}
          </Table>
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={setPage} />
        </>
      )}
    </Card>
  );
}

function EventsTable({ from, to }: { from: string; to: string }) {
  const [page, setPage] = useState(1);
  const canWrite = useAuth((s) => s.can('attendance:write'));
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['attendance', 'events', from, to, page],
    queryFn: () =>
      api<PaginatedResponse<AttendanceEventRow>>('/attendance/events', {
        query: { from, to, page, pageSize: 25 },
      }),
  });
  const voidEvent = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api(`/attendance/events/${id}/void`, { method: 'POST', body: { reason } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attendance'] }),
  });

  return (
    <Card>
      {isLoading && <Spinner />}
      {error && <ErrorState error={error} />}
      {voidEvent.error && <ErrorState error={voidEvent.error} />}
      {data && (
        <>
          <Table
            head={['Fecha y hora', 'Empleado', 'Tipo', 'Origen', 'Nota', '']}
            empty={data.data.length === 0}
          >
            {data.data.map((e) => (
              <tr key={e.id} className={clsx(e.voidedAt && 'opacity-50')}>
                <Td className="tabular whitespace-nowrap">{formatDateTime(e.occurredAt)}</Td>
                <Td>
                  {e.employee?.fullName ?? (
                    <span className="text-ink-3">ID {e.deviceUserId} sin empleado</span>
                  )}
                </Td>
                <Td className="text-ink-2">{PUNCH_LABEL[e.punchType]}</Td>
                <Td className="text-ink-2">
                  {e.source === 'MANUAL' ? 'Manual' : (e.deviceName ?? 'Dispositivo')}
                </Td>
                <Td className="max-w-xs truncate text-xs text-ink-2">
                  {e.voidedAt ? `Anulada: ${e.voidReason}` : (e.note ?? '')}
                </Td>
                <Td className="text-right">
                  {canWrite && !e.voidedAt && (
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      onClick={() => {
                        const reason = window.prompt('Motivo de la anulación (mín. 5 caracteres)');
                        if (reason && reason.trim().length >= 5)
                          voidEvent.mutate({ id: e.id, reason: reason.trim() });
                      }}
                    >
                      Anular
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={setPage} />
        </>
      )}
    </Card>
  );
}

function ManualEventForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const employees = useQuery({
    queryKey: ['employees', 'options'],
    queryFn: () =>
      api<PaginatedResponse<EmployeeRow>>('/employees', {
        query: { pageSize: 100, status: 'ACTIVE' },
      }),
  });
  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [time, setTime] = useState('08:00');
  const [reason, setReason] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api('/attendance/events', {
        method: 'POST',
        // The browser interprets date+time in the user's local zone, matching the operator's intent.
        body: { employeeId, occurredAt: new Date(`${date}T${time}:00`).toISOString(), reason },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['attendance'] });
      onDone();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Card className="mb-6">
      <form onSubmit={submit} className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Empleado">
          <Select required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Seleccione…</option>
            {employees.data?.data.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.lastName} {emp.firstName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Fecha">
          <Input
            type="date"
            required
            value={date}
            max={todayIso()}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Hora">
          <Input type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field label="Justificación" hint="Queda registrada en auditoría">
          <Input
            required
            minLength={5}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <div className="flex items-end gap-2">
          <Button
            type="submit"
            variant="primary"
            loading={create.isPending}
            disabled={!employeeId || reason.trim().length < 5}
          >
            Registrar
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancelar
          </Button>
        </div>
        {create.error && (
          <p role="alert" className="text-sm text-critical sm:col-span-2 lg:col-span-5">
            {create.error.message}
          </p>
        )}
      </form>
    </Card>
  );
}
