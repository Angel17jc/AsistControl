import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '../../lib/api';
import { VACATION_COUNTING_LABEL, formatDate, formatDateTime, formatDays } from '../../lib/format';
import type { ContractTypeRow, VacationBalance } from '../../lib/types';
import { Button, Card, CardHeader, ErrorState, Field, Input, Select, Spinner } from '../ui';

/**
 * An employee's vacation balance, broken down so it can be checked by hand:
 * available = accrued + adjustments − used − scheduled − pending. With `manage`, HR can
 * change the contract type and record adjustments from here.
 */
export function VacationBalanceCard({
  employeeId,
  title,
  manage = false,
  className,
}: {
  employeeId: string;
  title: string;
  manage?: boolean;
  className?: string;
}) {
  const balance = useQuery({
    queryKey: ['vacation-balance', employeeId],
    queryFn: () => api<VacationBalance>(`/employees/${employeeId}/vacation-balance`),
  });
  const b = balance.data;

  return (
    <Card className={className}>
      <CardHeader
        title={title}
        subtitle={
          b?.contractType
            ? `${b.contractType.name} · ${VACATION_COUNTING_LABEL[b.contractType.vacationDayCounting]}`
            : b
              ? 'Sin tipo de contrato: no se calcula el derecho a vacaciones'
              : undefined
        }
      />
      {balance.isLoading && <Spinner />}
      {balance.error && <ErrorState error={balance.error} />}
      {b && (
        <div className="space-y-5 p-5">
          <p>
            <span
              className={
                b.availableDays < 0
                  ? 'text-3xl font-semibold text-critical'
                  : 'text-3xl font-semibold'
              }
            >
              {formatDays(b.availableDays)}
            </span>{' '}
            <span className="text-sm text-ink-2">disponibles hoy</span>
          </p>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            <Figure label="Devengados" value={b.accruedDays} />
            <Figure label="Ajustes" value={b.adjustmentDays} signed />
            <Figure label="Usados" value={b.usedDays} />
            <Figure label="Programados" value={b.scheduledDays} />
            <Figure label="Pendientes" value={b.pendingDays} />
          </dl>
          {b.accrual && b.contractType && (
            <p className="text-xs text-ink-3">
              {b.accrual.completedServiceYears} año(s) de servicio · el año en curso vale{' '}
              {formatDays(b.accrual.currentYearEntitlement)}
              {b.accrual.nextCreditOn &&
                ` · próximo abono el ${formatDate(b.accrual.nextCreditOn)}`}
            </p>
          )}
          {manage && (
            <div className="grid gap-4 border-t border-line pt-4 lg:grid-cols-2">
              <ContractPicker employeeId={employeeId} current={b.contractType?.id ?? ''} />
              <AdjustmentForm employeeId={employeeId} />
            </div>
          )}
          {b.adjustments.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
                Ajustes
              </h3>
              <ul className="space-y-1 text-sm">
                {b.adjustments.slice(0, 5).map((a) => (
                  <li key={a.id} className="flex gap-3">
                    <span className="tabular w-20 shrink-0 font-medium">
                      {a.days > 0 ? '+' : ''}
                      {formatDays(a.days)}
                    </span>
                    <span className="min-w-0 flex-1 text-ink-2">{a.reason}</span>
                    <span className="shrink-0 text-xs text-ink-3">
                      {formatDateTime(a.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Figure({ label, value, signed }: { label: string; value: number; signed?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="tabular font-medium text-ink-1">
        {signed && value > 0 ? '+' : ''}
        {formatDays(value)}
      </dd>
    </div>
  );
}

function ContractPicker({ employeeId, current }: { employeeId: string; current: string }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(current);
  const types = useQuery({
    queryKey: ['contract-types'],
    queryFn: () => api<ContractTypeRow[]>('/contract-types'),
  });
  const save = useMutation({
    mutationFn: () =>
      api(`/employees/${employeeId}`, {
        method: 'PATCH',
        body: { contractTypeId: value || null },
      }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['vacation-balance', employeeId] }),
        queryClient.invalidateQueries({ queryKey: ['employees'] }),
      ]),
  });

  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label="Tipo de contrato">
        <Select value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Sin tipo de contrato</option>
          {types.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" loading={save.isPending} disabled={value === current}>
        Cambiar
      </Button>
      {save.error && (
        <p role="alert" className="text-sm text-critical">
          {save.error.message}
        </p>
      )}
    </form>
  );
}

function AdjustmentForm({ employeeId }: { employeeId: string }) {
  const queryClient = useQueryClient();
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  const add = useMutation({
    mutationFn: () =>
      api(`/employees/${employeeId}/vacation-adjustments`, {
        method: 'POST',
        body: { days: Number(days), reason },
      }),
    onSuccess: async () => {
      setDays('');
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['vacation-balance', employeeId] });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    add.mutate();
  }

  return (
    <form
      onSubmit={submit}
      aria-label="Ajustar saldo"
      className="grid gap-2 sm:grid-cols-[7rem_1fr_auto] sm:items-end"
    >
      <Field label="Días">
        <Input
          type="number"
          step="0.5"
          min={-365}
          max={365}
          // A hint below the field would push it out of line with the reason and the button.
          placeholder="2 o -1,5"
          required
          value={days}
          onChange={(e) => setDays(e.target.value)}
        />
      </Field>
      <Field label="Motivo del ajuste">
        <Input
          required
          minLength={5}
          placeholder="Saldo del sistema anterior"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <Button
        type="submit"
        loading={add.isPending}
        disabled={!days || Number(days) === 0 || reason.trim().length < 5}
      >
        Ajustar
      </Button>
      {add.error && (
        <p role="alert" className="text-sm text-critical sm:col-span-3">
          {add.error.message}
        </p>
      )}
    </form>
  );
}
