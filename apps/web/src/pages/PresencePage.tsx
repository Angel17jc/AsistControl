import {
  PRESENCE_STATES,
  type PresenceBoard,
  type PresenceEntry,
  type PresenceState,
} from '@asistcontrol/shared';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { PRESENCE_STATE } from '../components/status';
import {
  Card,
  ErrorState,
  Field,
  Input,
  PageHeader,
  PageHelp,
  Select,
  Spinner,
  StatusBadge,
  Table,
  Td,
  ToneIcon,
} from '../components/ui';
import { api } from '../lib/api';
import {
  LEAVE_LABEL,
  READING_LABEL,
  formatDate,
  formatTime,
  localDate,
  setDisplayTimezone,
} from '../lib/format';

/** Who is in right now. Refreshed by every punch (realtime) and once a minute. */
export function PresencePage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['attendance', 'presence'],
    queryFn: () => api<PresenceBoard>('/attendance/presence'),
    // Punches refresh it at once; the minute tick catches people who become late.
    refetchInterval: 60_000,
  });
  const [state, setState] = useState<PresenceState | null>(null);
  const [department, setDepartment] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (data?.timezone) setDisplayTimezone(data.timezone);
  }, [data?.timezone]);

  const departments = [
    ...new Set(data?.entries.map((e) => e.employee.department).filter((d) => d !== null)),
  ].sort((a, b) => a.localeCompare(b));
  const needle = search.trim().toLowerCase();
  // Night shifts show punches of another date: dated against the board's own moment.
  const today = data ? localDate(data.at) : '';
  const inDepartment = (data?.entries ?? []).filter(
    (e) => !department || e.employee.department === department,
  );
  const shown = inDepartment.filter(
    (e) =>
      (!state || e.state === state) &&
      (!needle ||
        `${e.employee.firstName} ${e.employee.lastName} ${e.employee.employeeCode}`
          .toLowerCase()
          .includes(needle)),
  );

  return (
    <>
      <PageHeader
        title="Presencia"
        description={
          data
            ? `Quién está ahora, ${formatTime(data.at)}. Se actualiza solo con cada marcación.`
            : 'Quién está ahora, según las marcaciones'
        }
      />
      <PageHelp>
        <p>
          Cada persona aparece según su última marcación de hoy y su horario. Toque un estado para
          ver solo a esas personas.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong className="text-ink-1">En la empresa</strong>: su última marcación fue una
            entrada (o el regreso del almuerzo).
          </li>
          <li>
            <strong className="text-ink-1">En almuerzo</strong>: marcó una salida cerca de la hora
            de almuerzo de su turno y aún no marca el regreso.
          </li>
          <li>
            <strong className="text-ink-1">Ya salió</strong>: marcó su salida. Si fue antes de su
            hora, se indica.
          </li>
          <li>
            <strong className="text-ink-1">No ha llegado</strong>: ya pasó su hora de entrada más la
            tolerancia y no ha marcado. Puede que llegue tarde u olvidara marcar.
          </li>
          <li>
            <strong className="text-ink-1">Aún no es su hora</strong>: su turno empieza más tarde, o
            todavía está dentro de la tolerancia.
          </li>
          <li>
            <strong className="text-ink-1">Permiso</strong>: tiene un permiso o vacaciones aprobados
            para este momento.
          </li>
          <li>
            <strong className="text-ink-1">Día libre</strong>: hoy no le toca trabajar (descanso o
            feriado). <strong className="text-ink-1">Sin horario</strong>: no tiene horario
            asignado; asígnelo en Horarios.
          </li>
        </ul>
        <p>Los turnos de noche cuentan como un solo día aunque pasen la medianoche.</p>
      </PageHelp>

      {isLoading && <Spinner />}
      {error && <ErrorState error={error} />}
      {data && (
        <>
          <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filtrar por estado">
            {PRESENCE_STATES.map((s) => {
              const count = inDepartment.filter((e) => e.state === s).length;
              const active = state === s;
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setState(active ? null : s)}
                  className={clsx(
                    'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    active
                      ? 'border-accent bg-accent/10 text-ink-1'
                      : 'border-line bg-surface-1 text-ink-2 hover:bg-surface-2',
                    count === 0 && !active && 'opacity-60',
                  )}
                >
                  <ToneIcon tone={PRESENCE_STATE[s].tone} />
                  {PRESENCE_STATE[s].label}
                  <span className="tabular font-semibold text-ink-1">{count}</span>
                </button>
              );
            })}
          </div>

          <Card>
            <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
              <Field label="Buscar">
                <Input
                  type="search"
                  placeholder="Nombre, apellido o código"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-56"
                />
              </Field>
              {departments.length > 0 && (
                <Field label="Departamento">
                  <Select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-56"
                  >
                    <option value="">Todos</option>
                    {departments.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
            <Table
              head={['Empleado', 'Estado', 'Entrada', 'Última marcación', 'Turno']}
              empty={shown.length === 0}
            >
              {shown.map((e) => (
                <tr key={e.employee.id}>
                  <Td>
                    <p className="font-medium">
                      {e.employee.lastName} {e.employee.firstName}
                    </p>
                    <p className="text-xs text-ink-3">
                      {e.employee.department ?? e.employee.employeeCode}
                    </p>
                  </Td>
                  <Td>
                    <StatusBadge tone={PRESENCE_STATE[e.state].tone}>
                      {PRESENCE_STATE[e.state].label}
                    </StatusBadge>
                    {detail(e, data.at) && (
                      <p className="mt-1 text-xs text-ink-3">{detail(e, data.at)}</p>
                    )}
                  </Td>
                  <Td className="tabular whitespace-nowrap">
                    {formatTime(e.firstIn)}
                    {e.lateMinutes > 0 && (
                      <p className="text-xs text-warning">{e.lateMinutes} min tarde</p>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {e.lastPunch ? (
                      <>
                        <span className="tabular">{timeOf(e.lastPunch.at, today)}</span>{' '}
                        <span className="text-ink-2">{READING_LABEL[e.lastPunch.reading]}</span>
                        <p className="text-xs text-ink-3">{e.lastPunch.deviceName ?? 'Manual'}</p>
                      </>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td className="tabular whitespace-nowrap text-ink-2">
                    {e.shift ? `${formatTime(e.shift.start)}–${formatTime(e.shift.end)}` : '—'}
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}
    </>
  );
}

/** The line under the state: since when, until when, or what to do. `at` is the board's moment. */
function detail(e: PresenceEntry, at: string): string | null {
  const today = localDate(at);
  switch (e.state) {
    case 'IN':
      return e.lastPunch ? `desde ${timeOf(e.lastPunch.at, today)}` : null;
    case 'ON_BREAK': {
      const back = e.shift?.breakEnd ? ` · vuelve ${formatTime(e.shift.breakEnd)}` : '';
      return e.lastPunch ? `desde ${timeOf(e.lastPunch.at, today)}${back}` : null;
    }
    case 'LEFT': {
      if (!e.lastPunch) return null;
      const early =
        e.expectedEnd && Date.parse(e.lastPunch.at) < Date.parse(e.expectedEnd)
          ? ' · antes de su hora'
          : '';
      return `a las ${timeOf(e.lastPunch.at, today)}${early}`;
    }
    case 'NOT_ARRIVED': {
      if (!e.expectedStart) return null;
      const over = e.expectedEnd !== null && Date.parse(at) >= Date.parse(e.expectedEnd);
      return over ? 'no marcó en todo su turno' : `debía entrar ${formatTime(e.expectedStart)}`;
    }
    case 'NOT_YET':
      return e.expectedStart ? `entra ${formatTime(e.expectedStart)}` : null;
    case 'ON_LEAVE':
      return e.leaveType ? LEAVE_LABEL[e.leaveType] : null;
    case 'NO_SCHEDULE':
      return 'Asígnele uno en Horarios';
    case 'DAY_OFF':
      return null;
  }
}

/** "22:05", or "22:05 (dom, 18 oct)" for a punch of another date (night shifts). */
function timeOf(iso: string, today: string): string {
  const date = localDate(iso);
  return date === today ? formatTime(iso) : `${formatTime(iso)} (${formatDate(date)})`;
}
