import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api } from '../../lib/api';
import { formatDateWithYear, todayIso } from '../../lib/format';
import type { HolidayRow } from '../../lib/types';
import { Button, Card, CardHeader, ErrorState, Field, Input, Spinner, Table, Td } from '../ui';

/**
 * Company holidays, a year at a time. Nobody is expected to work on one; adding or removing a
 * past holiday recomputes that day for everyone.
 */
export function HolidaysCard({ manage }: { manage: boolean }) {
  const queryClient = useQueryClient();
  const [year, setYear] = useState(() => Number(todayIso().slice(0, 4)));
  const holidays = useQuery({
    queryKey: ['holidays', year],
    queryFn: () => api<HolidayRow[]>('/holidays', { query: { year } }),
  });
  const changed = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['holidays'] }),
      queryClient.invalidateQueries({ queryKey: ['attendance'] }),
      queryClient.invalidateQueries({ queryKey: ['vacation-balance'] }),
    ]);
  const remove = useMutation({
    mutationFn: (id: string) => api(`/holidays/${id}`, { method: 'DELETE' }),
    onSuccess: changed,
  });

  return (
    <Card>
      <CardHeader
        title={`Feriados ${year}`}
        subtitle="No se espera trabajo; tampoco descuentan vacaciones en días hábiles"
        actions={
          <div className="flex gap-1">
            <Button
              variant="ghost"
              className="px-2"
              icon={<ChevronLeft className="size-4" />}
              aria-label="Año anterior"
              onClick={() => setYear((y) => y - 1)}
            />
            <Button
              variant="ghost"
              className="px-2"
              icon={<ChevronRight className="size-4" />}
              aria-label="Año siguiente"
              onClick={() => setYear((y) => y + 1)}
            />
          </div>
        }
      />
      {manage && <HolidayForm year={year} onAdded={changed} />}
      {holidays.isLoading && <Spinner />}
      {(holidays.error ?? remove.error) && <ErrorState error={holidays.error ?? remove.error} />}
      {holidays.data && (
        <Table head={['Fecha', 'Feriado', '']} empty={holidays.data.length === 0}>
          {holidays.data.map((h) => (
            <tr key={h.id}>
              <Td className="tabular whitespace-nowrap">{formatDateWithYear(h.date)}</Td>
              <Td>{h.name}</Td>
              <Td>
                {manage && (
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      icon={<Trash2 className="size-3.5 text-critical" />}
                      aria-label={`Eliminar feriado ${h.name}`}
                      loading={remove.isPending && remove.variables === h.id}
                      onClick={() => remove.mutate(h.id)}
                    >
                      Eliminar
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

function HolidayForm({ year, onAdded }: { year: number; onAdded: () => Promise<unknown> }) {
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: () => api('/holidays', { method: 'POST', body: { date, name } }),
    onSuccess: async () => {
      setDate('');
      setName('');
      await onAdded();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    add.mutate();
  }

  return (
    <form
      onSubmit={submit}
      aria-label="Nuevo feriado"
      className="grid gap-3 border-b border-line p-5 sm:grid-cols-[11rem_1fr_auto] sm:items-end"
    >
      <Field label="Fecha">
        <Input
          type="date"
          required
          min={`${year}-01-01`}
          max={`${year}-12-31`}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </Field>
      <Field label="Nombre del feriado">
        <Input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Button type="submit" loading={add.isPending} disabled={!date || name.trim().length < 2}>
        Añadir
      </Button>
      {add.error && (
        <p role="alert" className="text-sm text-critical sm:col-span-3">
          {add.error.message}
        </p>
      )}
    </form>
  );
}
