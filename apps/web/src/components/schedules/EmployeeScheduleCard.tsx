import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Undo2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api } from '../../lib/api';
import { formatDateWithYear, todayIso } from '../../lib/format';
import { type AssignmentState, assignmentState, canUndo, describeWeek } from '../../lib/schedules';
import type { ScheduleAssignmentRow, WorkScheduleRow } from '../../lib/types';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Select,
  Spinner,
  StatusBadge,
  type Tone,
} from '../ui';

const STATE: Record<AssignmentState, { label: string; tone: Tone }> = {
  current: { label: 'Vigente', tone: 'good' },
  scheduled: { label: 'Programado', tone: 'warning' },
  past: { label: 'Anterior', tone: 'neutral' },
};

/**
 * An employee's schedule history, newest first. A change never rewrites the past: each period
 * keeps the schedule its days were evaluated with. With `manage`, HR can assign a schedule from
 * a date (closing the current one the day before) and undo the latest assignment.
 */
export function EmployeeScheduleCard({
  employeeId,
  title,
  manage = false,
}: {
  employeeId: string;
  title: string;
  manage?: boolean;
}) {
  const history = useQuery({
    queryKey: ['employee-schedules', employeeId],
    queryFn: () => api<ScheduleAssignmentRow[]>(`/employees/${employeeId}/schedules`),
  });
  const schedules = useQuery({
    queryKey: ['work-schedules'],
    queryFn: () => api<WorkScheduleRow[]>('/work-schedules'),
  });
  const weekOf = (id: string) => {
    const schedule = schedules.data?.find((s) => s.id === id);
    return schedule ? describeWeek(schedule.days) : '';
  };
  const today = todayIso();
  const latest = history.data?.[0];

  return (
    <Card>
      <CardHeader
        title={title}
        subtitle="Un cambio de horario no altera cómo se evaluaron los días anteriores"
      />
      {history.isLoading && <Spinner />}
      {history.error && <ErrorState error={history.error} />}
      {history.data && (
        <div className="space-y-5 p-5">
          {history.data.length === 0 ? (
            <EmptyState
              title="Sin horario asignado"
              description="Sin horario no se calculan atrasos ni ausencias."
            />
          ) : (
            <ol className="space-y-3" aria-label="Historial de horarios">
              {history.data.map((a) => {
                const state = STATE[assignmentState(a, today)];
                return (
                  <li key={a.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink-1">{a.schedule.name}</p>
                      <p className="text-xs text-ink-3">{weekOf(a.schedule.id)}</p>
                    </div>
                    <p className="tabular text-ink-2">
                      {a.effectiveTo
                        ? `${formatDateWithYear(a.effectiveFrom)} – ${formatDateWithYear(a.effectiveTo)}`
                        : `desde ${formatDateWithYear(a.effectiveFrom)}`}
                    </p>
                    <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                  </li>
                );
              })}
            </ol>
          )}
          {manage && latest && canUndo(latest, today) && (
            <UndoLatest employeeId={employeeId} latest={latest} />
          )}
          {manage && (
            <AssignForm
              employeeId={employeeId}
              schedules={schedules.data ?? []}
              notBefore={latest?.effectiveFrom}
            />
          )}
        </div>
      )}
    </Card>
  );
}

/** Assigning or undoing changes the schedule of past days, and so everything computed on it. */
function useScheduleChanged(employeeId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      [
        ['employee-schedules', employeeId],
        ['vacation-balance', employeeId],
        ['attendance'],
        ['dashboard'],
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
}

function AssignForm({
  employeeId,
  schedules,
  notBefore,
}: {
  employeeId: string;
  schedules: WorkScheduleRow[];
  notBefore: string | undefined;
}) {
  const changed = useScheduleChanged(employeeId);
  const [scheduleId, setScheduleId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const assign = useMutation({
    mutationFn: () =>
      api('/work-schedules/assignments', {
        method: 'POST',
        body: { employeeId, scheduleId, effectiveFrom },
      }),
    onSuccess: async () => {
      setScheduleId('');
      await changed();
    },
  });
  const selected = schedules.find((s) => s.id === scheduleId);
  // The API refuses a start on or before the latest one: say it before the round trip.
  const tooEarly = notBefore !== undefined && effectiveFrom <= notBefore;
  const earliestHint = notBefore && `Debe ser posterior al ${formatDateWithYear(notBefore)}`;

  function submit(e: FormEvent) {
    e.preventDefault();
    assign.mutate();
  }

  return (
    <form
      onSubmit={submit}
      aria-label="Asignar horario"
      className="grid gap-3 border-t border-line pt-4 sm:grid-cols-[1fr_11rem_auto] sm:items-start"
    >
      <Field label="Nuevo horario" hint={selected ? describeWeek(selected.days) : undefined}>
        <Select required value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}>
          <option value="">Elegir horario</option>
          {schedules.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Desde" hint={tooEarly ? earliestHint : undefined}>
        <Input
          type="date"
          required
          value={effectiveFrom}
          onChange={(e) => setEffectiveFrom(e.target.value)}
        />
      </Field>
      <Button
        type="submit"
        variant="primary"
        className="sm:mt-6"
        loading={assign.isPending}
        disabled={!scheduleId || !effectiveFrom || tooEarly}
      >
        Asignar
      </Button>
      {assign.error && (
        <p role="alert" className="text-sm text-critical sm:col-span-3">
          {assign.error.message}
        </p>
      )}
    </form>
  );
}

function UndoLatest({ employeeId, latest }: { employeeId: string; latest: ScheduleAssignmentRow }) {
  const changed = useScheduleChanged(employeeId);
  const [confirming, setConfirming] = useState(false);
  const undo = useMutation({
    mutationFn: () => api(`/work-schedules/assignments/${latest.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setConfirming(false);
      await changed();
    },
  });
  const what = `${latest.schedule.name} desde el ${formatDateWithYear(latest.effectiveFrom)}`;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {confirming ? (
        <>
          <span className="text-ink-2">
            ¿Deshacer {what}? El horario anterior vuelve a quedar vigente.
          </span>
          <Button variant="danger" loading={undo.isPending} onClick={() => undo.mutate()}>
            Sí, deshacer
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Cancelar
          </Button>
        </>
      ) : (
        <Button
          variant="ghost"
          icon={<Undo2 className="size-4" />}
          onClick={() => setConfirming(true)}
        >
          Deshacer último cambio
        </Button>
      )}
      {undo.error && (
        <p role="alert" className="w-full text-critical">
          {undo.error.message}
        </p>
      )}
    </div>
  );
}
