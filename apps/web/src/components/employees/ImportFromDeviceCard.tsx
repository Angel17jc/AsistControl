import {
  COMPANY_SCHEDULE_NAME,
  type DevicePerson,
  type ImportEmployeesResult,
} from '@asistcontrol/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api } from '../../lib/api';
import { todayIso } from '../../lib/format';
import { splitDeviceName } from '../../lib/names';
import type { DeviceRow, WorkScheduleRow } from '../../lib/types';
import { Button, Card, CardHeader, Field, Input, Select } from '../ui';

interface Row {
  person: DevicePerson;
  selected: boolean;
  firstName: string;
  lastName: string;
}

const SKIP_REASON: Record<ImportEmployeesResult['skipped'][number]['reason'], string> = {
  ALREADY_REGISTERED: 'ya estaba registrada',
  CODE_IN_USE: 'su código ya lo usa otra persona',
};

/**
 * Employees from the people already registered on a terminal: their number and name come
 * from it, HR confirms how the name splits, and the cédula is completed later in each record.
 */
export function ImportFromDeviceCard({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api<DeviceRow[]>('/devices') });
  const schedules = useQuery({
    queryKey: ['work-schedules'],
    queryFn: () => api<WorkScheduleRow[]>('/work-schedules'),
  });
  const usable = devices.data?.filter((d) => d.status !== 'DISABLED') ?? [];
  const [deviceId, setDeviceId] = useState('');
  const chosenDevice = deviceId || usable[0]?.id || '';
  const [rows, setRows] = useState<Row[] | null>(null);
  const [hireDate, setHireDate] = useState(`${todayIso().slice(0, 8)}01`);
  const [scheduleChoice, setScheduleChoice] = useState<string | null>(null);
  const companySchedule = schedules.data?.find((s) => s.name === COMPANY_SCHEDULE_NAME)?.id ?? '';
  const scheduleId = scheduleChoice ?? companySchedule;

  const read = useMutation({
    mutationFn: () => api<DevicePerson[]>(`/devices/${chosenDevice}/people`),
    onSuccess: (people) =>
      setRows(
        people.map((person) => ({
          person,
          selected: person.employee === null,
          ...splitDeviceName(person.name),
        })),
      ),
  });
  const save = useMutation({
    mutationFn: (people: Row[]) =>
      api<ImportEmployeesResult>('/employees/import', {
        method: 'POST',
        body: {
          hireDate,
          ...(scheduleId && { scheduleId }),
          people: people.map((r) => ({
            biometricId: r.person.deviceUserId,
            firstName: r.firstName.trim(),
            lastName: r.lastName.trim(),
          })),
        },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees'] }),
  });

  const chosen = rows?.filter((r) => r.selected && r.person.employee === null) ?? [];
  const incomplete = chosen.filter((r) => !r.firstName.trim() || !r.lastName.trim());
  const update = (index: number, change: Partial<Row>) =>
    setRows((current) => current && current.map((r, i) => (i === index ? { ...r, ...change } : r)));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (chosen.length > 0 && incomplete.length === 0) save.mutate(chosen);
  }

  return (
    <Card className="mb-6">
      <CardHeader
        title="Importar del marcador"
        subtitle="Crea las fichas de quienes ya están registrados en el marcador, con su número y su nombre"
      />
      {save.data ? (
        <div role="status" className="grid gap-2 p-5 text-sm text-ink-1">
          <p>
            {save.data.created.length === 1
              ? 'Se creó 1 empleado.'
              : `Se crearon ${save.data.created.length} empleados.`}{' '}
            Complete la cédula de cada uno en su ficha (Editar).
          </p>
          {save.data.skipped.length > 0 && (
            <ul className="list-inside list-disc text-ink-2">
              {save.data.skipped.map((s) => (
                <li key={s.biometricId}>
                  ID {s.biometricId}: no se importó, {SKIP_REASON[s.reason]}.
                </li>
              ))}
            </ul>
          )}
          <div>
            <Button onClick={onDone}>Cerrar</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} aria-label="Importar del marcador" className="grid gap-4 p-5">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Marcador">
              <Select
                value={chosenDevice}
                onChange={(e) => (setDeviceId(e.target.value), setRows(null))}
                className="w-64"
              >
                {usable.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              type="button"
              icon={<Download className="size-4" />}
              loading={read.isPending}
              disabled={!chosenDevice}
              onClick={() => read.mutate()}
            >
              Leer el marcador
            </Button>
          </div>
          {devices.data && usable.length === 0 && (
            <p className="text-sm text-ink-2">Primero registre el marcador en Dispositivos.</p>
          )}
          {read.error && (
            <p role="alert" className="text-sm text-critical">
              {read.error.message}
            </p>
          )}

          {rows && (
            <>
              <p className="text-sm text-ink-2">
                {rows.length} personas en el marcador. Revise cómo quedan los nombres y los
                apellidos: el marcador los guarda juntos.
              </p>
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-ink-3">
                    <tr>
                      <th className="px-3 py-2">Importar</th>
                      <th className="px-3 py-2">ID</th>
                      <th className="px-3 py-2">En el marcador</th>
                      <th className="px-3 py-2">Nombres</th>
                      <th className="px-3 py-2">Apellidos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => {
                      const registered = row.person.employee;
                      return (
                        <tr key={row.person.deviceUserId} className="border-t border-line">
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              className="size-4 accent-[var(--accent)]"
                              aria-label={`Importar a ${row.person.name}`}
                              checked={row.selected && !registered}
                              disabled={!!registered}
                              onChange={(e) => update(i, { selected: e.target.checked })}
                            />
                          </td>
                          <td className="tabular px-3 py-2 text-ink-2">
                            {row.person.deviceUserId}
                          </td>
                          <td className="px-3 py-2 text-ink-2">
                            {row.person.name}
                            {row.person.admin && (
                              <span className="block text-xs text-ink-3">
                                Administrador del marcador
                              </span>
                            )}
                          </td>
                          {registered ? (
                            <td colSpan={2} className="px-3 py-2 text-ink-3">
                              Ya registrada: {registered.firstName} {registered.lastName} ·{' '}
                              {registered.employeeCode}
                            </td>
                          ) : (
                            <>
                              <td className="px-3 py-2">
                                <Input
                                  aria-label={`Nombres de ${row.person.name}`}
                                  value={row.firstName}
                                  disabled={!row.selected}
                                  onChange={(e) => update(i, { firstName: e.target.value })}
                                />
                              </td>
                              <td className="px-3 py-2">
                                <Input
                                  aria-label={`Apellidos de ${row.person.name}`}
                                  value={row.lastName}
                                  disabled={!row.selected}
                                  onChange={(e) => update(i, { lastName: e.target.value })}
                                />
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Fecha de ingreso"
                  hint="Para todos; desde este día cuentan sus jornadas. Se puede cambiar en cada ficha"
                >
                  <Input
                    type="date"
                    required
                    value={hireDate}
                    onChange={(e) => setHireDate(e.target.value)}
                  />
                </Field>
                <Field label="Horario" hint="El que tendrán todos desde su fecha de ingreso">
                  <Select value={scheduleId} onChange={(e) => setScheduleChoice(e.target.value)}>
                    <option value="">Sin horario por ahora</option>
                    {schedules.data?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {incomplete.length > 0 && (
                <p className="text-sm text-ink-2">
                  Falta el nombre o el apellido de{' '}
                  {incomplete.length === 1 ? '1 persona' : `${incomplete.length} personas`}.
                </p>
              )}
              {save.error && (
                <p role="alert" className="text-sm text-critical">
                  {save.error.message}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  variant="primary"
                  loading={save.isPending}
                  disabled={chosen.length === 0 || incomplete.length > 0 || !hireDate}
                >
                  {chosen.length === 1
                    ? 'Importar 1 persona'
                    : `Importar ${chosen.length} personas`}
                </Button>
                <Button type="button" variant="ghost" onClick={onDone}>
                  Cancelar
                </Button>
              </div>
            </>
          )}
          {!rows && (
            <div>
              <Button type="button" variant="ghost" onClick={onDone}>
                Cancelar
              </Button>
            </div>
          )}
        </form>
      )}
    </Card>
  );
}
