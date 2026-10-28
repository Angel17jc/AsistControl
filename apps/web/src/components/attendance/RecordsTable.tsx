import { ATTENDANCE_STATUSES, type PaginatedResponse } from '@asistcontrol/shared';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Printer } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { api } from '../../lib/api';
import {
  ANOMALY_LABEL,
  formatDate,
  formatDateWithYear,
  formatMinutes,
  formatTime,
} from '../../lib/format';
import { breaksOf, timecardTotals } from '../../lib/timecard';
import type { AttendanceRecordRow, EmployeeRow } from '../../lib/types';
import { useAuth } from '../../stores/auth';
import { ATTENDANCE_STATUS } from '../status';
import {
  Button,
  Card,
  ErrorState,
  Pagination,
  Select,
  Spinner,
  StatusBadge,
  Table,
  Td,
} from '../ui';

type Person = Pick<EmployeeRow, 'firstName' | 'lastName' | 'employeeCode'> & {
  department: { name: string } | null;
};

/**
 * Daily attendance records. Choosing one employee turns the table into their time card: the
 * whole period in date order, with totals and a printed version to sign.
 */
export function RecordsTable({ from, to }: { from: string; to: string }) {
  const canListEmployees = useAuth((s) => s.can('employees:read'));
  const ownEmployeeId = useAuth((s) => s.user?.employeeId ?? null);
  const [status, setStatus] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [page, setPage] = useState(1);
  // Someone who only sees themselves always looks at their own card.
  const cardOf = canListEmployees ? employeeId : (ownEmployeeId ?? '');

  const employees = useQuery({
    queryKey: ['employees', 'options'],
    queryFn: () =>
      api<PaginatedResponse<EmployeeRow>>('/employees', {
        query: { pageSize: 100, status: 'ACTIVE' },
      }),
    enabled: canListEmployees,
  });
  const { data, isLoading, error } = useQuery({
    queryKey: ['attendance', 'records', from, to, cardOf ? '' : status, cardOf, page],
    queryFn: () =>
      api<PaginatedResponse<AttendanceRecordRow>>('/attendance/records', {
        // A card is the whole period (at most 93 days) on one page, every status included.
        query: cardOf
          ? { from, to, employeeId: cardOf, pageSize: 100 }
          : { from, to, status, page, pageSize: 25 },
      }),
  });
  const rows = cardOf ? [...(data?.data ?? [])].reverse() : (data?.data ?? []);
  const person: Person | undefined = cardOf
    ? (employees.data?.data.find((e) => e.id === cardOf) ?? data?.data[0]?.employee)
    : undefined;

  return (
    <Card>
      <div className="flex flex-wrap justify-end gap-2 border-b border-line px-4 py-3 print:hidden">
        {canListEmployees && (
          <Select
            aria-label="Empleado"
            className="w-60"
            value={employeeId}
            onChange={(e) => (setEmployeeId(e.target.value), setPage(1))}
          >
            <option value="">Todos los empleados</option>
            {employees.data?.data.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.lastName} {emp.firstName}
              </option>
            ))}
          </Select>
        )}
        {cardOf ? (
          <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>
            Imprimir
          </Button>
        ) : (
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
        )}
      </div>
      {cardOf && data && person && (
        <TimecardHeader person={person} from={from} to={to} records={data.data} />
      )}
      {isLoading && <Spinner />}
      {error && <ErrorState error={error} />}
      {data && (
        <>
          <Table
            head={[
              'Fecha',
              ...(cardOf ? [] : ['Empleado']),
              'Estado',
              'Horario',
              'Entrada',
              'Almuerzo',
              'Salida',
              'Trabajado',
              'Atraso',
              'Extra',
              'Novedades',
            ]}
            empty={rows.length === 0}
          >
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap text-ink-2">{formatDate(r.workDate)}</Td>
                {!cardOf && (
                  <Td>
                    <p className="font-medium">
                      {r.employee.lastName} {r.employee.firstName}
                    </p>
                    <p className="text-xs text-ink-3">
                      {r.employee.department?.name ?? r.employee.employeeCode}
                    </p>
                  </Td>
                )}
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
                <Td className="tabular">{formatTime(entryOf(r))}</Td>
                <Td className="tabular whitespace-nowrap">
                  <Breaks record={r} />
                </Td>
                <Td className="tabular whitespace-nowrap">
                  {formatTime(exitOf(r))}
                  {r.earlyLeaveMinutes > 0 && (
                    <p className="text-xs text-warning">{r.earlyLeaveMinutes} min antes</p>
                  )}
                </Td>
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
          {!cardOf && (
            <div className="print:hidden">
              <Pagination
                page={data.meta.page}
                totalPages={data.meta.totalPages}
                onChange={setPage}
              />
            </div>
          )}
          {cardOf && (
            <div className="hidden gap-16 px-5 pt-20 pb-6 text-xs text-ink-2 print:flex">
              <p className="flex-1 border-t border-ink-3 pt-1 text-center">Firma del empleado</p>
              <p className="flex-1 border-t border-ink-3 pt-1 text-center">
                Firma de Talento Humano
              </p>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/**
 * Entry and exit as the day's first and last stretch have them: a return nobody closed shows
 * no exit (the day is "Sin salida"), not the exit before it.
 */
const entryOf = (r: AttendanceRecordRow) => (r.segments.length > 0 ? r.segments[0]!.in : r.firstIn);
const exitOf = (r: AttendanceRecordRow) =>
  r.segments.length > 0 ? r.segments.at(-1)!.out : r.lastOut;

/** Lunch and other pauses as punched, or the scheduled lunch deducted without punches. */
function Breaks({ record }: { record: AttendanceRecordRow }) {
  const breaks = breaksOf(record.segments);
  if (breaks.length > 0) {
    return breaks.map((b) => (
      <p key={b.out}>
        {formatTime(b.out)}–{formatTime(b.back)}
      </p>
    ));
  }
  if (record.breakMinutes > 0) {
    return (
      <span
        className="text-xs text-ink-3"
        title="No marcó el almuerzo: se descontó el de su horario"
      >
        {formatMinutes(record.breakMinutes)} sin marcar
      </span>
    );
  }
  return '—';
}

function TimecardHeader({
  person,
  from,
  to,
  records,
}: {
  person: Person;
  from: string;
  to: string;
  records: AttendanceRecordRow[];
}) {
  const t = timecardTotals(records);
  return (
    <section aria-label="Tarjeta de tiempo" className="border-b border-line px-5 py-4">
      <h2 className="text-sm font-semibold text-ink-1">
        Tarjeta de tiempo · {person.lastName} {person.firstName}
      </h2>
      <p className="mt-0.5 text-xs text-ink-3">
        {person.employeeCode}
        {person.department ? ` · ${person.department.name}` : ''} · del {formatDateWithYear(from)}{' '}
        al {formatDateWithYear(to)}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <Total label="Días trabajados">{t.daysWorked}</Total>
        <Total label="Trabajado">{formatMinutes(t.workedMinutes)}</Total>
        <Total label="Atrasos">
          {t.lateDays > 0 ? `${t.lateDays} · ${t.lateMinutes} min` : '—'}
        </Total>
        <Total label="Salidas anticipadas">
          {t.earlyLeaveMinutes > 0 ? `${t.earlyLeaveMinutes} min` : '—'}
        </Total>
        <Total label="Horas extra">
          {t.overtimeMinutes > 0 ? formatMinutes(t.overtimeMinutes) : '—'}
        </Total>
        <Total label="Ausencias">{t.absences}</Total>
      </dl>
      <p className="mt-3 text-xs text-ink-3">
        Las horas extra son las calculadas; se aprueban en Solicitudes.
      </p>
      {t.incomplete > 0 && (
        <p className="mt-2 flex items-start gap-2 text-xs text-ink-1">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
          {t.incomplete === 1 ? 'Hay 1 día incompleto' : `Hay ${t.incomplete} días incompletos`}:
          falta una entrada o una salida. Corríjalos con «Corrección manual» antes de cerrar el
          período.
        </p>
      )}
    </section>
  );
}

function Total({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="tabular mt-0.5 font-medium text-ink-1">{children}</dd>
    </div>
  );
}
