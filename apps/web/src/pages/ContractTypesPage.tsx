import {
  VACATION_ACCRUALS,
  VACATION_DAY_COUNTINGS,
  type VacationAccrual,
  type VacationDayCounting,
} from '@asistcontrol/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Table,
  Td,
} from '../components/ui';
import { api } from '../lib/api';
import { VACATION_ACCRUAL_LABEL, VACATION_COUNTING_LABEL, formatDays } from '../lib/format';
import type { ContractTypeRow } from '../lib/types';
import { useAuth } from '../stores/auth';

/**
 * Contract types and the vacation rules each one carries. The values are the company's
 * policy, not a country's law: changing them changes every balance at once, because
 * balances are computed from these rules on every read.
 */
export function ContractTypesPage() {
  const canWrite = useAuth((s) => s.can('organization:write'));
  const [editing, setEditing] = useState<ContractTypeRow | 'new' | null>(null);
  const queryClient = useQueryClient();
  const types = useQuery({
    queryKey: ['contract-types'],
    queryFn: () => api<ContractTypeRow[]>('/contract-types'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/contract-types/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['contract-types'] }),
  });

  return (
    <>
      <PageHeader
        title="Contratos"
        description="Reglas de vacaciones de cada tipo de contrato. Son política de la empresa: ajústelas a sus contratos."
        actions={
          canWrite && (
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              onClick={() => setEditing('new')}
            >
              Nuevo tipo de contrato
            </Button>
          )
        }
      />
      {editing && (
        <Card className="mb-6">
          <ContractTypeForm
            key={editing === 'new' ? 'new' : editing.id}
            contractType={editing === 'new' ? undefined : editing}
            onDone={() => setEditing(null)}
          />
        </Card>
      )}
      {(types.error ?? remove.error) && <ErrorState error={types.error ?? remove.error} />}
      <Card>
        {types.isLoading && <Spinner />}
        {types.data && (
          <Table
            head={[
              'Tipo de contrato',
              'Días por año',
              'Devengo',
              'Descuenta',
              'Antigüedad',
              'Anticipos',
              'Empleados',
              '',
            ]}
            empty={types.data.length === 0}
          >
            {types.data.map((t) => (
              <tr key={t.id}>
                <Td className="font-medium">{t.name}</Td>
                <Td className="tabular">{formatDays(t.vacationDaysPerYear)}</Td>
                <Td className="text-ink-2">{VACATION_ACCRUAL_LABEL[t.vacationAccrual]}</Td>
                <Td className="text-ink-2">{VACATION_COUNTING_LABEL[t.vacationDayCounting]}</Td>
                <Td className="text-ink-2">
                  {t.seniority
                    ? `+${formatDays(t.seniority.extraDaysPerYear)}/año desde el año ${t.seniority.afterYears + 1}, máx. ${formatDays(t.seniority.maxExtraDays)}`
                    : '—'}
                </Td>
                <Td className="text-ink-2">{t.allowNegativeVacationBalance ? 'Sí' : 'No'}</Td>
                <Td className="tabular">{t.employees ?? 0}</Td>
                <Td>
                  {canWrite && (
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs"
                        icon={<Pencil className="size-3.5" />}
                        aria-label={`Editar ${t.name}`}
                        onClick={() => setEditing(t)}
                      >
                        Editar
                      </Button>
                      {/* Only unused types can go: the API refuses the rest anyway. */}
                      {(t.employees ?? 0) === 0 && (
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-xs"
                          icon={<Trash2 className="size-3.5 text-critical" />}
                          aria-label={`Eliminar ${t.name}`}
                          loading={remove.isPending && remove.variables === t.id}
                          onClick={() => remove.mutate(t.id)}
                        >
                          Eliminar
                        </Button>
                      )}
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

function ContractTypeForm({
  contractType,
  onDone,
}: {
  contractType?: ContractTypeRow;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: contractType?.name ?? '',
    vacationDaysPerYear: String(contractType?.vacationDaysPerYear ?? 15),
    vacationAccrual: contractType?.vacationAccrual ?? ('ANNUAL' as VacationAccrual),
    vacationDayCounting:
      contractType?.vacationDayCounting ?? ('WORKING_DAYS' as VacationDayCounting),
    allowNegativeVacationBalance: contractType?.allowNegativeVacationBalance ?? false,
  });
  const [seniority, setSeniority] = useState(
    contractType?.seniority !== null && contractType !== undefined,
  );
  const [bonus, setBonus] = useState({
    afterYears: String(contractType?.seniority?.afterYears ?? 5),
    extraDaysPerYear: String(contractType?.seniority?.extraDaysPerYear ?? 1),
    maxExtraDays: String(contractType?.seniority?.maxExtraDays ?? 15),
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        vacationDaysPerYear: Number(form.vacationDaysPerYear),
        seniority: seniority
          ? {
              afterYears: Number(bonus.afterYears),
              extraDaysPerYear: Number(bonus.extraDaysPerYear),
              maxExtraDays: Number(bonus.maxExtraDays),
            }
          : null,
      };
      return contractType
        ? api(`/contract-types/${contractType.id}`, { method: 'PATCH', body })
        : api('/contract-types', { method: 'POST', body });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contract-types'] }),
        queryClient.invalidateQueries({ queryKey: ['vacation-balance'] }),
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
      aria-label={contractType ? `Editar ${contractType.name}` : 'Nuevo tipo de contrato'}
      className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4"
    >
      <Field label="Nombre">
        <Input
          required
          minLength={2}
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </Field>
      <Field label="Días de vacaciones por año">
        <Input
          type="number"
          required
          min={0}
          max={365}
          step="0.5"
          value={form.vacationDaysPerYear}
          onChange={(e) => setForm((f) => ({ ...f, vacationDaysPerYear: e.target.value }))}
        />
      </Field>
      <Field label="Devengo">
        <Select
          value={form.vacationAccrual}
          onChange={(e) =>
            setForm((f) => ({ ...f, vacationAccrual: e.target.value as VacationAccrual }))
          }
        >
          {VACATION_ACCRUALS.map((a) => (
            <option key={a} value={a}>
              {VACATION_ACCRUAL_LABEL[a]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Qué días descuenta una vacación">
        <Select
          value={form.vacationDayCounting}
          onChange={(e) =>
            setForm((f) => ({ ...f, vacationDayCounting: e.target.value as VacationDayCounting }))
          }
        >
          {VACATION_DAY_COUNTINGS.map((c) => (
            <option key={c} value={c}>
              {VACATION_COUNTING_LABEL[c]}
            </option>
          ))}
        </Select>
      </Field>

      <div className="space-y-2 text-sm sm:col-span-2 lg:col-span-4">
        <label className="flex items-center gap-2 text-ink-2">
          <input
            type="checkbox"
            className="size-4 accent-[var(--accent)]"
            checked={seniority}
            onChange={(e) => setSeniority(e.target.checked)}
          />
          Días extra por antigüedad
        </label>
        <label className="flex items-center gap-2 text-ink-2">
          <input
            type="checkbox"
            className="size-4 accent-[var(--accent)]"
            checked={form.allowNegativeVacationBalance}
            onChange={(e) =>
              setForm((f) => ({ ...f, allowNegativeVacationBalance: e.target.checked }))
            }
          />
          Permitir anticipos (pedir más días de los disponibles)
        </label>
      </div>

      {seniority && (
        <>
          <Field label="A partir de (años cumplidos)">
            <Input
              type="number"
              required
              min={0}
              max={60}
              value={bonus.afterYears}
              onChange={(e) => setBonus((b) => ({ ...b, afterYears: e.target.value }))}
            />
          </Field>
          <Field label="Días extra por cada año más">
            <Input
              type="number"
              required
              min={0.5}
              max={30}
              step="0.5"
              value={bonus.extraDaysPerYear}
              onChange={(e) => setBonus((b) => ({ ...b, extraDaysPerYear: e.target.value }))}
            />
          </Field>
          <Field label="Máximo de días extra">
            <Input
              type="number"
              required
              min={0}
              max={365}
              step="0.5"
              value={bonus.maxExtraDays}
              onChange={(e) => setBonus((b) => ({ ...b, maxExtraDays: e.target.value }))}
            />
          </Field>
        </>
      )}

      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit" variant="primary" loading={save.isPending}>
          {contractType ? 'Guardar cambios' : 'Crear'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        {contractType && (
          <p className="text-xs text-ink-3">
            Los saldos de sus empleados se recalculan con las nuevas reglas.
          </p>
        )}
      </div>
      {save.error && (
        <p role="alert" className="text-sm text-critical sm:col-span-2 lg:col-span-4">
          {save.error.message}
        </p>
      )}
    </form>
  );
}
