import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import {
  Button,
  Card,
  CardHeader,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
} from '../components/ui';
import { api } from '../lib/api';
import { todayIso } from '../lib/format';
import type { AttendancePolicy, SettingsResponse } from '../lib/types';
import { useAuth } from '../stores/auth';

type Keys<T> = {
  [K in keyof AttendancePolicy]: AttendancePolicy[K] extends T ? K : never;
}[keyof AttendancePolicy];

/** How each rule is shown: label, a plain explanation and the API's limits. */
type Rule =
  | { kind: 'number'; key: Keys<number>; label: string; hint: string; max: number }
  | { kind: 'toggle'; key: Keys<boolean>; label: string; hint: string }
  | {
      kind: 'choice';
      key: 'overtimeBasis' | 'punchPairing';
      label: string;
      hint: string;
      options: Record<string, string>;
    };

const GROUPS: { title: string; subtitle: string; rules: Rule[] }[] = [
  {
    title: 'Marcaciones',
    subtitle: 'Cómo se leen las marcaciones de los equipos',
    rules: [
      {
        kind: 'number',
        key: 'duplicatePunchWindowSeconds',
        label: 'Marcación repetida (segundos)',
        hint: 'Dos marcaciones de la misma persona separadas por menos de esto cuentan como una sola.',
        max: 600,
      },
      {
        kind: 'choice',
        key: 'punchPairing',
        label: 'Entradas y salidas',
        hint: 'Alternadas tolera que alguien pulse la tecla equivocada en el equipo.',
        options: {
          SEQUENTIAL: 'Alternadas: entrada, salida, entrada…',
          DEVICE_TYPE: 'Según la tecla pulsada en el equipo',
        },
      },
      {
        kind: 'number',
        key: 'punchWindowBeforeShiftMinutes',
        label: 'La jornada empieza a contar (min antes del turno)',
        hint: 'Las marcaciones desde esta hora pertenecen a ese día de trabajo. Importa en turnos nocturnos.',
        max: 720,
      },
      {
        kind: 'number',
        key: 'punchWindowAfterShiftMinutes',
        label: 'La jornada deja de contar (min después del turno)',
        hint: 'Las marcaciones hasta esta hora todavía pertenecen a ese día de trabajo.',
        max: 720,
      },
      {
        kind: 'number',
        key: 'outOfScheduleMarginMinutes',
        label: 'Margen fuera de horario (min)',
        hint: 'Una marcación más temprana o más tardía que esto respecto al turno se señala como fuera de horario.',
        max: 720,
      },
    ],
  },
  {
    title: 'Atrasos y salidas',
    subtitle: 'Cada turno puede tener sus propias tolerancias; si no, rigen estas',
    rules: [
      {
        kind: 'number',
        key: 'lateToleranceMinutes',
        label: 'Tolerancia de atraso (min)',
        hint: 'Llegar dentro de estos minutos después del inicio no cuenta como atraso.',
        max: 240,
      },
      {
        kind: 'number',
        key: 'earlyLeaveToleranceMinutes',
        label: 'Tolerancia de salida anticipada (min)',
        hint: 'Salir dentro de estos minutos antes del fin no se señala.',
        max: 240,
      },
    ],
  },
  {
    title: 'Almuerzo',
    subtitle: 'Para los turnos que tienen almuerzo programado',
    rules: [
      {
        kind: 'toggle',
        key: 'autoDeductUnpunchedBreak',
        label: 'Descontar el almuerzo programado si no se marcó',
        hint: 'Si nadie marcó la salida y el regreso del almuerzo, se descuenta el tiempo programado.',
      },
      {
        kind: 'number',
        key: 'minBreakMinutes',
        label: 'Almuerzo mínimo (min)',
        hint: 'Un almuerzo más corto se señala. 0 desactiva el aviso.',
        max: 240,
      },
    ],
  },
  {
    title: 'Horas extra',
    subtitle: 'Cada turno puede tener su propio mínimo; si no, rige este',
    rules: [
      {
        kind: 'choice',
        key: 'overtimeBasis',
        label: 'Qué cuenta como hora extra',
        hint: 'Por exceso de jornada, un atraso se compensa antes de contar horas extra.',
        options: {
          AFTER_SHIFT_END: 'Lo trabajado después de la hora de salida',
          EXCESS_WORKED_TIME: 'Lo trabajado por encima de la jornada',
        },
      },
      {
        kind: 'number',
        key: 'overtimeThresholdMinutes',
        label: 'Mínimo para reconocer horas extra (min)',
        hint: 'Por debajo de esto, el tiempo extra no se cuenta.',
        max: 480,
      },
      {
        kind: 'toggle',
        key: 'countEarlyArrivalAsOvertime',
        label: 'Contar la llegada anticipada como hora extra',
        hint: 'Solo cuando cuenta lo trabajado después de la hora de salida.',
      },
    ],
  },
];

/**
 * The company's labor rules. They are policy, not law: every value is the company's to set.
 * Saved rules apply to the days computed from then on; past days need a recalculation.
 */
export function SettingsPage() {
  const canRecompute = useAuth((s) => s.can('attendance:write'));
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<SettingsResponse>('/settings'),
  });

  return (
    <>
      <PageHeader
        title="Configuración"
        description="Reglas de asistencia de la empresa. Son política interna: ajústelas a su reglamento."
      />
      {settings.isLoading && <Spinner />}
      {settings.error && <ErrorState error={settings.error} />}
      {settings.data && (
        <div className="grid gap-6">
          <PolicyForm settings={settings.data} />
          {canRecompute && <RecomputeCard />}
        </div>
      )}
    </>
  );
}

function PolicyForm({ settings }: { settings: SettingsResponse }) {
  const canWrite = useAuth((s) => s.can('settings:write'));
  const queryClient = useQueryClient();
  const saved = settings.attendancePolicy;
  const [draft, setDraft] = useState<AttendancePolicy>(saved);

  const changed = (Object.keys(draft) as (keyof AttendancePolicy)[]).filter(
    (key) => draft[key] !== saved[key],
  );
  const invalid = GROUPS.flatMap((g) => g.rules).some(
    (rule) =>
      rule.kind === 'number' &&
      !(Number.isInteger(draft[rule.key]) && draft[rule.key] >= 0 && draft[rule.key] <= rule.max),
  );

  const save = useMutation({
    // Only what changed: two people editing different rules do not undo each other.
    mutationFn: () =>
      api<AttendancePolicy>('/settings/attendance-policy', {
        method: 'PATCH',
        body: Object.fromEntries(changed.map((key) => [key, draft[key]])),
      }),
    onSuccess: (policy) => {
      queryClient.setQueryData<SettingsResponse>(['settings'], {
        ...settings,
        attendancePolicy: policy,
      });
      setDraft(policy);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <form onSubmit={submit} aria-label="Reglas de asistencia" className="grid gap-6">
      {!canWrite && (
        <p className="rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm text-ink-2">
          Puede consultar estas reglas; solo un administrador puede cambiarlas.
        </p>
      )}
      <fieldset disabled={!canWrite} className="grid gap-6 lg:grid-cols-2">
        {GROUPS.map((group) => (
          <Card key={group.title}>
            <CardHeader title={group.title} subtitle={group.subtitle} />
            <div className="grid gap-4 px-5 py-4">
              {group.rules.map((rule) => (
                <RuleField
                  key={rule.key}
                  rule={rule}
                  draft={draft}
                  onChange={(value) => (
                    setDraft((d) => ({ ...d, [rule.key]: value })),
                    save.reset()
                  )}
                />
              ))}
            </div>
          </Card>
        ))}
      </fieldset>
      <p className="text-sm text-ink-3">Zona horaria de la empresa: {settings.timezone}</p>
      {canWrite && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="primary"
            loading={save.isPending}
            disabled={changed.length === 0 || invalid}
          >
            Guardar reglas
          </Button>
          {changed.length > 0 && (
            <Button type="button" variant="ghost" onClick={() => setDraft(saved)}>
              Descartar cambios
            </Button>
          )}
          {save.isSuccess && changed.length === 0 && (
            <p role="status" className="text-sm text-ink-1">
              Reglas guardadas. Se aplican a las jornadas que se calculen desde ahora; para días
              pasados, recalcúlelos abajo.
            </p>
          )}
          {save.error && (
            <p role="alert" className="text-sm text-critical">
              {save.error.message}
            </p>
          )}
        </div>
      )}
    </form>
  );
}

function RuleField({
  rule,
  draft,
  onChange,
}: {
  rule: Rule;
  draft: AttendancePolicy;
  onChange: (value: AttendancePolicy[keyof AttendancePolicy]) => void;
}) {
  if (rule.kind === 'toggle') {
    // Early arrivals only matter when overtime starts at the scheduled end.
    const disabled =
      rule.key === 'countEarlyArrivalAsOvertime' && draft.overtimeBasis !== 'AFTER_SHIFT_END';
    return (
      <div className="text-sm">
        <label className="inline-flex items-start gap-2 font-medium text-ink-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={draft[rule.key]}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
          {rule.label}
        </label>
        <p className="ml-6 text-xs text-ink-3">{rule.hint}</p>
      </div>
    );
  }
  if (rule.kind === 'choice') {
    return (
      <Field label={rule.label} hint={rule.hint}>
        <Select
          value={draft[rule.key]}
          onChange={(e) => onChange(e.target.value as AttendancePolicy[typeof rule.key])}
        >
          {Object.entries(rule.options).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  const value = draft[rule.key];
  return (
    <Field label={rule.label} hint={`${rule.hint} Entre 0 y ${rule.max}.`}>
      <Input
        type="number"
        required
        min={0}
        max={rule.max}
        step={1}
        className="w-32"
        value={Number.isNaN(value) ? '' : value}
        onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
      />
    </Field>
  );
}

const MAX_RANGE_DAYS = 31;

/** Applies the rules in force to days already computed (the API allows up to 31 at a time). */
function RecomputeCard() {
  const [from, setFrom] = useState(todayIso().slice(0, 8) + '01');
  const [to, setTo] = useState(todayIso());
  const queryClient = useQueryClient();
  const recompute = useMutation({
    mutationFn: () =>
      api<{ recomputed: number }>('/attendance/recompute', { method: 'POST', body: { from, to } }),
    onSuccess: () =>
      Promise.all(
        [['attendance'], ['dashboard'], ['report']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  });

  const days = from && to ? (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 : 0;
  const problem =
    days < 1
      ? 'La fecha final debe ser igual o posterior a la inicial.'
      : days > MAX_RANGE_DAYS
        ? `El rango no puede pasar de ${MAX_RANGE_DAYS} días.`
        : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!problem) recompute.mutate();
  }

  return (
    <Card>
      <CardHeader
        title="Recalcular jornadas"
        subtitle="Vuelve a calcular días ya registrados con las reglas y horarios vigentes. Las marcaciones no cambian."
      />
      <form
        onSubmit={submit}
        aria-label="Recalcular jornadas"
        className="grid gap-4 px-5 py-4 sm:grid-cols-[auto_auto_1fr] sm:items-end"
      >
        <Field label="Desde">
          <Input
            type="date"
            required
            value={from}
            onChange={(e) => (setFrom(e.target.value), recompute.reset())}
          />
        </Field>
        <Field label="Hasta">
          <Input
            type="date"
            required
            value={to}
            onChange={(e) => (setTo(e.target.value), recompute.reset())}
          />
        </Field>
        <div>
          <Button type="submit" loading={recompute.isPending} disabled={problem !== null}>
            Recalcular
          </Button>
        </div>
        {problem && (
          <p role="alert" className="text-sm text-critical sm:col-span-3">
            {problem}
          </p>
        )}
        {recompute.error && (
          <p role="alert" className="text-sm text-critical sm:col-span-3">
            {recompute.error.message}
          </p>
        )}
        {recompute.data && (
          <p role="status" className="text-sm text-ink-1 sm:col-span-3">
            Se recalcularon {recompute.data.recomputed} jornadas.
          </p>
        )}
      </form>
    </Card>
  );
}
