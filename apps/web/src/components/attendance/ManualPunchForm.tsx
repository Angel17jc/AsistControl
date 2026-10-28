import type { PaginatedResponse, PunchType } from '@asistcontrol/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import {
  ANOMALY_LABEL,
  PUNCH_LABEL,
  READING_LABEL,
  formatDate,
  formatMinutes,
  formatTime,
  localDate,
  todayIso,
} from '../../lib/format';
import type { DayPreview, DaySummary, EmployeeRow } from '../../lib/types';
import { ATTENDANCE_STATUS } from '../status';
import { Button, Card, CardHeader, ErrorState, Field, Input, Select, StatusBadge } from '../ui';

type Mode = 'one' | 'day';
type ProposedPunch = { occurredAt: string; punchType: PunchType };

const MODE_HINT: Record<Mode, string> = {
  one: 'Olvidó marcar la entrada, la salida o el almuerzo.',
  day: 'No marcó en todo el día: se registran la entrada y la salida juntas.',
};

/** Offered only when the company trusts the key pressed on the terminal. */
const PICKABLE_TYPES: PunchType[] = ['UNKNOWN', 'CHECK_IN', 'BREAK_OUT', 'BREAK_IN', 'CHECK_OUT'];

/**
 * Adds the punches someone forgot. Before saving it shows how the whole work day will be
 * read, as computed by the API, so nobody has to guess whether a time counts as entry or exit.
 */
export function ManualPunchForm({ onDone }: { onDone: () => void }) {
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
  const [mode, setMode] = useState<Mode>('one');
  const [time, setTime] = useState('08:00');
  const [type, setType] = useState<PunchType>('UNKNOWN');
  const [entry, setEntry] = useState('08:00');
  const [exit, setExit] = useState('17:00');
  const [reason, setReason] = useState('');

  const now = useNow();
  const punches = proposedPunches(mode, date, { time, type }, { entry, exit });
  // A minute of grace: the clock is refreshed every 30 s and the API allows a few minutes.
  const inFuture = punches?.some((p) => new Date(p.occurredAt).getTime() > now + 60_000) ?? false;
  const preview = useQuery({
    queryKey: ['manual-preview', employeeId, punches],
    queryFn: () =>
      api<DayPreview>('/attendance/events/preview', {
        method: 'POST',
        body: { employeeId, punches },
      }),
    enabled: Boolean(employeeId && punches),
    placeholderData: keepPreviousData,
  });
  const pairing = preview.data?.punchPairing;
  const shift = preview.data?.shift;

  const create = useMutation({
    mutationFn: () =>
      api('/attendance/events/batch', {
        method: 'POST',
        body: { employeeId, punches, reason: reason.trim() },
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
      <CardHeader
        title="Corrección manual"
        subtitle="Para cuando alguien olvidó marcar o el marcador falló. Lo que registró el marcador nunca se cambia: se agrega una marcación manual que queda en Auditoría con su usuario."
      />
      <form onSubmit={submit} className="grid gap-5 p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Empleado" hint="Solo aparecen los empleados activos.">
            <Select required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Seleccione…</option>
              {employees.data?.data.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.lastName} {emp.firstName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Fecha" hint="El día en que debió marcar.">
            <Input
              type="date"
              required
              value={date}
              max={todayIso()}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="¿Qué falta?" hint={MODE_HINT[mode]}>
            <Select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <option value="one">Una marcación</option>
              <option value="day">Toda la jornada: entrada y salida</option>
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {mode === 'one' ? (
            <>
              <Field
                label="Hora"
                hint={
                  pairing === 'DEVICE_TYPE'
                    ? 'La hora en que debió marcar.'
                    : 'La hora en que debió marcar. Si cuenta como entrada o salida lo decide el orden del día: véalo abajo.'
                }
              >
                <Input
                  type="time"
                  required
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </Field>
              {pairing === 'DEVICE_TYPE' && (
                <Field
                  label="Tipo"
                  hint="La tecla que debió pulsar en el marcador. «Automático» la deduce del orden."
                >
                  <Select value={type} onChange={(e) => setType(e.target.value as PunchType)}>
                    {PICKABLE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t === 'UNKNOWN' ? 'Automático' : PUNCH_LABEL[t]}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </>
          ) : (
            <>
              <Field label="Hora de entrada" hint="Cuando empezó a trabajar.">
                <Input
                  type="time"
                  required
                  value={entry}
                  onChange={(e) => setEntry(e.target.value)}
                />
              </Field>
              <Field
                label="Hora de salida"
                hint="Si es menor que la de entrada, se toma del día siguiente (turno de noche)."
              >
                <Input
                  type="time"
                  required
                  value={exit}
                  onChange={(e) => setExit(e.target.value)}
                />
              </Field>
              {shift && (
                <div className="flex items-start sm:pt-7">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setEntry(formatTime(shift.start));
                      setExit(formatTime(shift.end));
                    }}
                  >
                    Usar su turno ({formatTime(shift.start)}–{formatTime(shift.end)})
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        {inFuture && (
          <p role="alert" className="text-sm text-critical">
            Esa hora todavía no llega: no se puede registrar una marcación futura.
          </p>
        )}
        {preview.error && <ErrorState error={preview.error} />}
        {preview.data && <DayPreviewPanel preview={preview.data} updating={preview.isFetching} />}

        <Field
          label="Motivo"
          hint="Por qué se agrega a mano, p. ej. «Olvidó marcar la salida; lo confirmó su supervisor». Mínimo 5 caracteres. Queda en Auditoría."
        >
          <Input
            required
            minLength={5}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
            loading={create.isPending}
            disabled={!employeeId || !punches || inFuture || reason.trim().length < 5}
          >
            {mode === 'day' ? 'Registrar entrada y salida' : 'Registrar marcación'}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancelar
          </Button>
        </div>
        {create.error && (
          <p role="alert" className="text-sm text-critical">
            {createErrorMessage(create.error)}
          </p>
        )}
      </form>
    </Card>
  );
}

function DayPreviewPanel({ preview, updating }: { preview: DayPreview; updating: boolean }) {
  const { before, after } = preview;
  const strayProposed = preview.punches.some((p) => p.proposed && p.reading === 'OTHER_DAY');
  return (
    <section
      aria-label="Cómo quedará la jornada"
      aria-busy={updating}
      className={clsx(
        'rounded-lg border border-line bg-surface-2/40 p-4 text-sm transition-opacity',
        updating && 'opacity-60',
      )}
    >
      <h3 className="font-semibold text-ink-1">
        Así quedará la jornada del {formatDate(preview.workDate)}
      </h3>
      <p className="mt-0.5 text-xs text-ink-3">{describeDay(preview)}</p>

      {!preview.employed && (
        <Warning>
          Esa fecha está fuera de su período de trabajo (antes del ingreso o después de la baja): la
          marcación se guarda, pero no cuenta.
        </Warning>
      )}
      {strayProposed && (
        <Warning>
          Una de las horas nuevas queda fuera de esta jornada (su turno más el margen permitido),
          así que no contará en ella. Revise la fecha y la hora.
        </Warning>
      )}

      <ol className="mt-3 divide-y divide-line rounded-md border border-line bg-surface-1">
        {preview.punches.map((p, i) => (
          <li
            key={p.id ?? `proposed-${i}`}
            className={clsx(
              'flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2',
              p.proposed && 'bg-accent/5',
            )}
          >
            <span className="tabular min-w-12 font-medium text-ink-1">
              {formatTime(p.occurredAt)}
              {/* Night shifts span two dates: say which one when it is not the work date. */}
              {localDate(p.occurredAt) !== preview.workDate && (
                <span className="ml-1 text-xs font-normal text-ink-3">
                  ({formatDate(localDate(p.occurredAt))})
                </span>
              )}
            </span>
            <span
              className={clsx(
                'w-36',
                p.reading === 'DUPLICATE' || p.reading === 'OTHER_DAY'
                  ? 'text-ink-3'
                  : 'text-ink-1',
              )}
            >
              {READING_LABEL[p.reading]}
            </span>
            {p.proposed ? (
              <StatusBadge tone="info">Nueva</StatusBadge>
            ) : (
              <span className="text-xs text-ink-3">{origin(p)}</span>
            )}
          </li>
        ))}
      </ol>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-ink-3">Estado</dt>
          <dd className="mt-1 flex flex-wrap items-center gap-1.5">
            {before ? (
              <StatusBadge tone={ATTENDANCE_STATUS[before.status].tone}>
                {ATTENDANCE_STATUS[before.status].label}
              </StatusBadge>
            ) : (
              <span className="text-xs text-ink-3">Sin jornada</span>
            )}
            <span aria-hidden>→</span>
            <span className="sr-only">pasa a</span>
            <StatusBadge tone={ATTENDANCE_STATUS[after.status].tone}>
              {ATTENDANCE_STATUS[after.status].label}
            </StatusBadge>
          </dd>
        </div>
        <Stat label="Trabajado">{formatMinutes(after.workedMinutes)}</Stat>
        <Stat label="Atraso">{after.lateMinutes > 0 ? `${after.lateMinutes} min` : '—'}</Stat>
        <Stat label="Novedades">{anomalies(after)}</Stat>
      </dl>

      <p className="mt-3 text-xs text-ink-3">
        {preview.punchPairing === 'SEQUENTIAL'
          ? 'Las marcaciones se leen por orden de hora: entrada, salida al almuerzo, regreso y salida, sin importar la tecla pulsada.'
          : 'Las marcaciones se leen según la tecla pulsada en el marcador.'}{' '}
        Se cambia en Configuración → Entradas y salidas.
      </p>
    </section>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="tabular mt-1 text-ink-1">{children}</dd>
    </div>
  );
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 flex items-start gap-2 text-xs text-ink-1">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
      {children}
    </p>
  );
}

/** The current time, refreshed every 30 s: enough to tell a punch in the future. */
function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function proposedPunches(
  mode: Mode,
  date: string,
  one: { time: string; type: PunchType },
  day: { entry: string; exit: string },
): ProposedPunch[] | null {
  if (!date) return null;
  if (mode === 'one') {
    return one.time ? [{ occurredAt: instant(date, one.time), punchType: one.type }] : null;
  }
  if (!day.entry || !day.exit) return null;
  const exitDate = day.exit <= day.entry ? nextDate(date) : date;
  return [
    { occurredAt: instant(date, day.entry), punchType: 'CHECK_IN' },
    { occurredAt: instant(exitDate, day.exit), punchType: 'CHECK_OUT' },
  ];
}

/** The browser reads date + time in the user's local zone, matching the operator's intent. */
function instant(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

function nextDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function describeDay(preview: DayPreview): string {
  if (preview.dayType === 'HOLIDAY') return 'Feriado: no tenía que trabajar.';
  if (!preview.hasSchedule) {
    return 'Sin horario asignado: no se pueden calcular atrasos ni horas extra. Asígnele uno en Horarios.';
  }
  if (preview.dayType === 'REST_DAY' || !preview.shift) return 'Día libre según su horario.';
  const { start, end, breakStart, breakEnd } = preview.shift;
  const lunch =
    breakStart && breakEnd ? ` · almuerzo ${formatTime(breakStart)}–${formatTime(breakEnd)}` : '';
  return `Turno ${formatTime(start)}–${formatTime(end)}${lunch}`;
}

function origin(p: DayPreview['punches'][number]): string {
  if (p.source !== 'MANUAL') return p.deviceName ?? 'Marcador';
  return p.note ? `Manual · ${p.note}` : 'Manual';
}

function anomalies(summary: DaySummary): string {
  return summary.anomalies.map((a) => ANOMALY_LABEL[a]).join(' · ') || '—';
}

function createErrorMessage(error: Error): string {
  if (error instanceof ApiError && error.status === 409) {
    return 'Ya hay una marcación manual de esta persona a esa hora.';
  }
  return error.message;
}
