import type { PaginatedResponse } from '@asistcontrol/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { ManualPunchForm } from '../components/attendance/ManualPunchForm';
import { RecordsTable } from '../components/attendance/RecordsTable';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  PageHeader,
  PageHelp,
  Pagination,
  Spinner,
  Table,
  Td,
} from '../components/ui';
import { api } from '../lib/api';
import { PUNCH_LABEL, formatDateTime, todayIso } from '../lib/format';
import type { AttendanceEventRow } from '../lib/types';
import { useAuth } from '../stores/auth';

/** [label, today → [from, to]]: the periods people pick most, in one click. */
const QUICK_PERIODS: [string, (today: string) => [string, string]][] = [
  ['Hoy', (today) => [today, today]],
  ['Este mes', (today) => [`${today.slice(0, 8)}01`, today]],
  [
    'Mes anterior',
    (today) => {
      const [y, m] = today.split('-').map(Number) as [number, number];
      // Day 0 of this month is the last day of the previous one.
      const last = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
      return [`${last.slice(0, 8)}01`, last];
    },
  ],
];

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
          <strong className="text-ink-1">Marcación fuera de jornada.</strong> Una marcación tan
          lejos de su turno que no entra en ninguna jornada (por ejemplo a las 23:30 con un turno
          que termina a las 17:00) no se cuenta, pero queda avisada en ese día para que alguien la
          revise. Si era un error, anúlela. Si de verdad trabajó hasta esa hora, amplíe en
          Configuración «La jornada deja de contar» y recalcule ese período.
        </p>
        <p>
          <strong className="text-ink-1">Tarjeta de tiempo.</strong> Elija un empleado en Jornadas y
          un período (por ejemplo «Este mes»): verá cada día con su entrada, almuerzo y salida, los
          totales del período y un botón para imprimirla y firmarla.
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
      {showManual && (
        <div className="print:hidden">
          <ManualPunchForm onDone={() => setShowManual(false)} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3 print:hidden">
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
        <div className="flex gap-1" role="group" aria-label="Período rápido">
          {QUICK_PERIODS.map(([label, period]) => (
            <Button
              key={label}
              variant="ghost"
              onClick={() => {
                const [start, end] = period(todayIso());
                setFrom(start);
                setTo(end);
              }}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      {tab === 'records' ? (
        <RecordsTable from={from} to={to} />
      ) : (
        <EventsTable from={from} to={to} />
      )}
    </>
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
