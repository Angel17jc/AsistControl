import { ATTENDANCE_STATUSES, type PaginatedResponse } from '@asistcontrol/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { ManualPunchForm } from '../components/attendance/ManualPunchForm';
import { ATTENDANCE_STATUS } from '../components/status';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  PageHeader,
  PageHelp,
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
import type { AttendanceEventRow, AttendanceRecordRow } from '../lib/types';
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
      <PageHelp>
        <p>
          <strong className="text-ink-1">Marcaciones.</strong> Cada vez que alguien pone el dedo, la
          tarjeta o su clave en el marcador queda una marcación con fecha y hora. El marcador solo
          guarda eso: quién y cuándo.
        </p>
        <p>
          <strong className="text-ink-1">Jornadas.</strong> El sistema junta las marcaciones de cada
          persona en su día y las lee en orden: entrada, salida al almuerzo, regreso y salida. Con
          su horario calcula lo trabajado, el atraso y las horas extra (estas se aprueban en
          Solicitudes). «Provisional» quiere decir que el día aún no termina y puede cambiar si
          llegan más marcaciones.
        </p>
        <p>
          <strong className="text-ink-1">Novedades.</strong> Lo que el sistema detectó en el día,
          por ejemplo «Sin salida» (olvidó marcar al irse) o «Fuera de horario».
        </p>
        <p>
          <strong className="text-ink-1">Corrección manual.</strong> Si alguien olvidó marcar o el
          marcador falló, agregue lo que falta. Antes de guardar verá cómo queda el día. Pide un
          motivo porque queda en Auditoría.
        </p>
        <p>
          <strong className="text-ink-1">Anular</strong> (pestaña Marcaciones). Para una marcación
          que no debe contar. No se borra: sigue a la vista, marcada como anulada y con su motivo.
        </p>
      </PageHelp>
      {showManual && <ManualPunchForm onDone={() => setShowManual(false)} />}

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
