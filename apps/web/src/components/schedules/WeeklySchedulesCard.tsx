import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api } from '../../lib/api';
import { WEEKDAYS, describeHours, describeWeek } from '../../lib/schedules';
import type { WorkScheduleRow, WorkShiftRow } from '../../lib/types';
import {
  Button,
  Card,
  CardHeader,
  ErrorState,
  Field,
  Input,
  Select,
  Spinner,
  Table,
  Td,
} from '../ui';

/** Weekly schedules: a shift (or rest) for each weekday. They are assigned to employees. */
export function WeeklySchedulesCard({ manage }: { manage: boolean }) {
  const [editing, setEditing] = useState<WorkScheduleRow | 'new' | null>(null);
  const schedules = useQuery({
    queryKey: ['work-schedules'],
    queryFn: () => api<WorkScheduleRow[]>('/work-schedules'),
  });

  return (
    <Card>
      <CardHeader
        title="Horarios semanales"
        subtitle="Se asignan a cada empleado desde su panel de horario"
        actions={
          manage && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Nuevo horario
            </Button>
          )
        }
      />
      {editing && (
        <ScheduleForm
          key={editing === 'new' ? 'new' : editing.id}
          schedule={editing === 'new' ? undefined : editing}
          onDone={() => setEditing(null)}
        />
      )}
      {schedules.isLoading && <Spinner />}
      {schedules.error && <ErrorState error={schedules.error} />}
      {schedules.data && (
        <Table head={['Horario', 'Semana', '']} empty={schedules.data.length === 0}>
          {schedules.data.map((s) => (
            <tr key={s.id}>
              <Td>
                <p className="font-medium">{s.name}</p>
                {s.description && <p className="text-xs text-ink-3">{s.description}</p>}
              </Td>
              <Td className="text-ink-2">{describeWeek(s.days)}</Td>
              <Td>
                {manage && (
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      icon={<Pencil className="size-3.5" />}
                      aria-label={`Editar horario ${s.name}`}
                      onClick={() => setEditing(s)}
                    >
                      Editar
                    </Button>
                  </div>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function ScheduleForm({ schedule, onDone }: { schedule?: WorkScheduleRow; onDone: () => void }) {
  const queryClient = useQueryClient();
  const shifts = useQuery({
    queryKey: ['work-shifts'],
    queryFn: () => api<WorkShiftRow[]>('/work-shifts'),
  });
  const [name, setName] = useState(schedule?.name ?? '');
  const [description, setDescription] = useState(schedule?.description ?? '');
  // weekday → shift id; '' is a rest day.
  const [week, setWeek] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      WEEKDAYS.map(([weekday]) => [
        weekday,
        schedule?.days.find((d) => d.weekday === weekday)?.shiftId ?? '',
      ]),
    ),
  );

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        description: description || null,
        days: WEEKDAYS.filter(([weekday]) => week[weekday]).map(([weekday]) => ({
          weekday,
          shiftId: week[weekday],
        })),
      };
      return schedule
        ? api(`/work-schedules/${schedule.id}`, { method: 'PATCH', body })
        : api('/work-schedules', { method: 'POST', body });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['work-schedules'] });
      onDone();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <form
      onSubmit={submit}
      aria-label={schedule ? `Editar horario ${schedule.name}` : 'Nuevo horario'}
      className="grid gap-4 border-b border-line p-5 lg:grid-cols-[1fr_2fr]"
    >
      <div className="space-y-4">
        <Field label="Nombre">
          <Input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Descripción">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-medium text-ink-2">Turno de cada día</legend>
        {WEEKDAYS.map(([weekday, label]) => (
          <Field key={weekday} label={label}>
            <Select
              value={week[weekday]}
              onChange={(e) => setWeek((w) => ({ ...w, [weekday]: e.target.value }))}
            >
              <option value="">Descanso</option>
              {shifts.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {describeHours(s.startTime, s.endTime)}
                </option>
              ))}
            </Select>
          </Field>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-2 lg:col-span-2">
        <Button type="submit" variant="primary" loading={save.isPending}>
          {schedule ? 'Guardar horario' : 'Crear horario'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        {schedule && (
          <p className="text-xs text-ink-3">
            Cambia el horario de todas las personas que lo tienen asignado. Para cambiar el de una
            sola persona desde una fecha, asígnele otro horario.
          </p>
        )}
      </div>
      {save.error && (
        <p role="alert" className="text-sm text-critical lg:col-span-2">
          {save.error.message}
        </p>
      )}
    </form>
  );
}
