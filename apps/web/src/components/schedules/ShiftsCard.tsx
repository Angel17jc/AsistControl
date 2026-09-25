import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api } from '../../lib/api';
import { describeHours } from '../../lib/schedules';
import type { WorkShiftRow } from '../../lib/types';
import { Button, Card, CardHeader, ErrorState, Field, Input, Spinner, Table, Td } from '../ui';

/**
 * Shift templates: the hours of one working day, reused by weekly schedules. Tolerances left
 * empty follow the attendance policy.
 */
export function ShiftsCard({ manage }: { manage: boolean }) {
  const [editing, setEditing] = useState<WorkShiftRow | 'new' | null>(null);
  const shifts = useQuery({
    queryKey: ['work-shifts'],
    queryFn: () => api<WorkShiftRow[]>('/work-shifts'),
  });

  return (
    <Card>
      <CardHeader
        title="Turnos"
        subtitle="Horas de una jornada; los horarios semanales los combinan"
        actions={
          manage && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Nuevo turno
            </Button>
          )
        }
      />
      {editing && (
        <ShiftForm
          key={editing === 'new' ? 'new' : editing.id}
          shift={editing === 'new' ? undefined : editing}
          onDone={() => setEditing(null)}
        />
      )}
      {shifts.isLoading && <Spinner />}
      {shifts.error && <ErrorState error={shifts.error} />}
      {shifts.data && (
        <Table
          head={['Turno', 'Horario', 'Almuerzo', 'Tolerancias', '']}
          empty={shifts.data.length === 0}
        >
          {shifts.data.map((s) => (
            <tr key={s.id}>
              <Td className="font-medium">{s.name}</Td>
              <Td className="tabular">{describeHours(s.startTime, s.endTime)}</Td>
              <Td className="tabular text-ink-2">
                {s.breakStart && s.breakEnd ? `${s.breakStart}–${s.breakEnd}` : '—'}
              </Td>
              <Td className="text-ink-2">{describeTolerances(s)}</Td>
              <Td>
                {manage && (
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      icon={<Pencil className="size-3.5" />}
                      aria-label={`Editar turno ${s.name}`}
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

function describeTolerances(s: WorkShiftRow): string {
  const parts = [
    s.lateToleranceMinutes !== null && `atraso ${s.lateToleranceMinutes} min`,
    s.earlyLeaveToleranceMinutes !== null && `salida ${s.earlyLeaveToleranceMinutes} min`,
    s.overtimeThresholdMinutes !== null && `extra desde ${s.overtimeThresholdMinutes} min`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Las de la política';
}

const optionalMinutes = (value: string) => (value === '' ? null : Number(value));

function ShiftForm({ shift, onDone }: { shift?: WorkShiftRow; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: shift?.name ?? '',
    startTime: shift?.startTime ?? '08:00',
    endTime: shift?.endTime ?? '17:00',
    breakStart: shift?.breakStart ?? '',
    breakEnd: shift?.breakEnd ?? '',
    lateToleranceMinutes: String(shift?.lateToleranceMinutes ?? ''),
    earlyLeaveToleranceMinutes: String(shift?.earlyLeaveToleranceMinutes ?? ''),
    overtimeThresholdMinutes: String(shift?.overtimeThresholdMinutes ?? ''),
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  // Lunch is both times or neither: the API refuses half of it.
  const breakIncomplete = (form.breakStart === '') !== (form.breakEnd === '');

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name,
        startTime: form.startTime,
        endTime: form.endTime,
        breakStart: form.breakStart || null,
        breakEnd: form.breakEnd || null,
        lateToleranceMinutes: optionalMinutes(form.lateToleranceMinutes),
        earlyLeaveToleranceMinutes: optionalMinutes(form.earlyLeaveToleranceMinutes),
        overtimeThresholdMinutes: optionalMinutes(form.overtimeThresholdMinutes),
      };
      return shift
        ? api(`/work-shifts/${shift.id}`, { method: 'PATCH', body })
        : api('/work-shifts', { method: 'POST', body });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['work-shifts'] }),
        queryClient.invalidateQueries({ queryKey: ['work-schedules'] }),
      ]);
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
      aria-label={shift ? `Editar turno ${shift.name}` : 'Nuevo turno'}
      className="grid gap-4 border-b border-line p-5 sm:grid-cols-2 lg:grid-cols-4"
    >
      <Field label="Nombre">
        <Input required minLength={2} value={form.name} onChange={set('name')} />
      </Field>
      <Field label="Entrada">
        <Input type="time" required value={form.startTime} onChange={set('startTime')} />
      </Field>
      <Field
        label="Salida"
        hint={
          form.endTime && form.endTime <= form.startTime ? 'Termina al día siguiente' : undefined
        }
      >
        <Input type="time" required value={form.endTime} onChange={set('endTime')} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Almuerzo desde">
          <Input type="time" value={form.breakStart} onChange={set('breakStart')} />
        </Field>
        <Field label="Almuerzo hasta">
          <Input type="time" value={form.breakEnd} onChange={set('breakEnd')} />
        </Field>
      </div>
      <Field label="Tolerancia de atraso (min)" hint="Vacío: la de la política">
        <Input
          type="number"
          min={0}
          max={240}
          value={form.lateToleranceMinutes}
          onChange={set('lateToleranceMinutes')}
        />
      </Field>
      <Field label="Tolerancia de salida (min)" hint="Vacío: la de la política">
        <Input
          type="number"
          min={0}
          max={240}
          value={form.earlyLeaveToleranceMinutes}
          onChange={set('earlyLeaveToleranceMinutes')}
        />
      </Field>
      <Field label="Horas extra desde (min)" hint="Vacío: lo de la política">
        <Input
          type="number"
          min={0}
          max={480}
          value={form.overtimeThresholdMinutes}
          onChange={set('overtimeThresholdMinutes')}
        />
      </Field>
      <div className="flex items-end gap-2">
        <Button type="submit" variant="primary" loading={save.isPending} disabled={breakIncomplete}>
          {shift ? 'Guardar turno' : 'Crear turno'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
      </div>
      {breakIncomplete && (
        <p className="text-sm text-ink-2 sm:col-span-2 lg:col-span-4">
          Indique las dos horas del almuerzo, o ninguna.
        </p>
      )}
      {shift && (
        <p className="text-xs text-ink-3 sm:col-span-2 lg:col-span-4">
          Afecta a todos los horarios que usan este turno, desde el próximo cálculo.
        </p>
      )}
      {save.error && (
        <p role="alert" className="text-sm text-critical sm:col-span-2 lg:col-span-4">
          {save.error.message}
        </p>
      )}
    </form>
  );
}
