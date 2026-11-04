import { COMPANY_SCHEDULE_NAME } from '@asistcontrol/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '../../lib/api';
import { useFeatures } from '../../lib/features';
import { todayIso } from '../../lib/format';
import { WEEKDAYS, expectedMinutes } from '../../lib/schedules';
import type { WorkScheduleRow } from '../../lib/types';
import { Button, Card, CardHeader, ErrorState, Field, Input, Spinner } from '../ui';

const MON_TO_FRI = [1, 2, 3, 4, 5];
/** Days the API recalculates when a date in the past is given. */
const MAX_DAYS_BACK = 62;

interface SetupResult {
  assigned: number;
  onSchedule: number;
  kept: number;
}

const minutesOf = (hhmm: string) => {
  const [hours = 0, minutes = 0] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
};
const daysBefore = (isoDate: string, days: number) =>
  new Date(Date.parse(`${isoDate}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

/**
 * All a company without fixed hours has to set: how long the day is, the lunch and the days
 * worked. It covers everyone at once, and can be run again to change it.
 */
export function QuickSetupCard() {
  const schedules = useQuery({
    queryKey: ['work-schedules'],
    queryFn: () => api<WorkScheduleRow[]>('/work-schedules'),
  });
  const { overtimeEnabled } = useFeatures();

  return (
    <Card>
      <CardHeader
        title="Jornada de la empresa"
        subtitle="Para empresas sin hora fija de entrada ni de salida: es lo único que hace falta configurar"
      />
      {schedules.isLoading && <Spinner />}
      {schedules.error && <ErrorState error={schedules.error} />}
      {schedules.data && (
        <SetupForm
          current={schedules.data.find((s) => s.name === COMPANY_SCHEDULE_NAME)}
          overtimeEnabled={overtimeEnabled}
        />
      )}
    </Card>
  );
}

function SetupForm({
  current,
  overtimeEnabled,
}: {
  current?: WorkScheduleRow;
  overtimeEnabled: boolean;
}) {
  const queryClient = useQueryClient();
  const shift = current?.days[0]?.shift;
  const today = todayIso();
  const [form, setForm] = useState({
    hours: shift ? String(expectedMinutes(shift) / 60) : '8',
    lunch: String(
      shift?.breakStart && shift.breakEnd
        ? minutesOf(shift.breakEnd) - minutesOf(shift.breakStart)
        : shift
          ? 0
          : 60,
    ),
    weekdays: current?.days.map((d) => d.weekday) ?? MON_TO_FRI,
    // Unless changed, the current month: what is usually being looked at.
    from: `${today.slice(0, 8)}01`,
    // Off for a new setup: most small companies asked do not pay it.
    overtime: current ? overtimeEnabled : false,
  });
  const earliest = daysBefore(today, MAX_DAYS_BACK);

  const save = useMutation({
    mutationFn: () =>
      api<SetupResult>('/work-schedules/setup', {
        method: 'POST',
        body: {
          dailyMinutes: Math.round(Number(form.hours) * 60),
          lunchMinutes: Number(form.lunch),
          weekdays: [...form.weekdays].sort((a, b) => a - b),
          effectiveFrom: form.from,
          overtimeEnabled: form.overtime,
        },
      }),
    onSuccess: () =>
      Promise.all(
        [
          ['work-shifts'],
          ['work-schedules'],
          ['settings'],
          ['employees'],
          ['attendance'],
          ['dashboard'],
          ['report'],
        ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ),
  });

  const toggleDay = (weekday: number) => {
    save.reset();
    setForm((f) => ({
      ...f,
      weekdays: f.weekdays.includes(weekday)
        ? f.weekdays.filter((d) => d !== weekday)
        : [...f.weekdays, weekday],
    }));
  };
  const set = (key: 'hours' | 'lunch' | 'from') => (e: { target: { value: string } }) => {
    save.reset();
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <form
      onSubmit={submit}
      aria-label="Jornada de la empresa"
      className="grid gap-4 p-5 sm:grid-cols-3"
    >
      <Field
        label="Horas de trabajo al día"
        hint="Sin contar el almuerzo. Si un día termina con menos, con 10 minutos de margen, se avisa"
      >
        <Input
          type="number"
          required
          min={1}
          max={12}
          step={0.5}
          value={form.hours}
          onChange={set('hours')}
        />
      </Field>
      <Field label="Almuerzo (minutos)" hint="Si alguien no lo marca, se le descuenta este tiempo">
        <Input
          type="number"
          required
          min={0}
          max={180}
          value={form.lunch}
          onChange={set('lunch')}
        />
      </Field>
      <Field
        label="Aplicar desde"
        hint="Las jornadas desde este día se vuelven a calcular. Hasta 62 días atrás"
      >
        <Input type="date" required min={earliest} value={form.from} onChange={set('from')} />
      </Field>
      <fieldset className="sm:col-span-3">
        <legend className="text-sm font-medium text-ink-1">Días laborables</legend>
        <p className="mt-0.5 text-xs text-ink-3">
          Los demás son días libres: quien no marca ese día no figura ausente.
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          {WEEKDAYS.map(([weekday, name]) => (
            <label key={weekday} className="flex items-center gap-2 text-sm text-ink-1">
              <input
                type="checkbox"
                className="size-4 accent-[var(--accent)]"
                checked={form.weekdays.includes(weekday)}
                onChange={() => toggleDay(weekday)}
              />
              {name}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-start gap-2 text-sm text-ink-1 sm:col-span-3">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-[var(--accent)]"
          checked={form.overtime}
          onChange={(e) => {
            save.reset();
            setForm((f) => ({ ...f, overtime: e.target.checked }));
          }}
        />
        <span>
          La empresa paga horas extra
          <span className="block text-xs text-ink-3">
            Si no las paga, no se calculan ni aparecen en las pantallas y los reportes.
          </span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
        <Button
          type="submit"
          variant="primary"
          loading={save.isPending}
          disabled={form.weekdays.length === 0}
        >
          Aplicar a todos los empleados
        </Button>
        {form.weekdays.length === 0 && (
          <p className="text-sm text-ink-2">Elija al menos un día laborable.</p>
        )}
        {save.data && <SetupOutcome result={save.data} />}
      </div>
      {save.error && (
        <p role="alert" className="text-sm text-critical sm:col-span-3">
          {save.error.message}
        </p>
      )}
    </form>
  );
}

function SetupOutcome({ result }: { result: SetupResult }) {
  const people = (n: number) => (n === 1 ? '1 empleado' : `${n} empleados`);
  if (result.onSchedule === 0 && result.kept === 0) {
    return (
      <p role="status" className="text-sm text-ink-1">
        Listo: la jornada quedó guardada. Los empleados que registre la tendrán desde su ingreso.
      </p>
    );
  }
  return (
    <p role="status" className="text-sm text-ink-1">
      Listo: {people(result.onSchedule)} con esta jornada.
      {result.kept > 0 &&
        ` ${people(result.kept)} conservan el horario que ya tenían desde esa fecha o después: revíselos en Empleados.`}
    </p>
  );
}
