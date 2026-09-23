import { LEAVE_TYPES, type LeaveType, type PaginatedResponse } from '@asistcontrol/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { REQUEST_STATUS } from '../components/status';
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
  StatusBadge,
  Table,
  Td,
} from '../components/ui';
import { api } from '../lib/api';
import { LEAVE_LABEL, formatDate, formatDateTime, formatMinutes } from '../lib/format';
import type { LeaveRow, OvertimeRow } from '../lib/types';
import { useAuth } from '../stores/auth';

const OVERTIME_LABEL = { REGULAR: 'Ordinaria', REST_DAY: 'Día libre', HOLIDAY: 'Feriado' } as const;

export function RequestsPage() {
  const canRequest = useAuth((s) => s.can('leave:request'));
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="Solicitudes"
        description="Permisos, vacaciones y horas extra pendientes de aprobación"
        actions={
          canRequest && (
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              onClick={() => setCreating(true)}
            >
              Solicitar permiso
            </Button>
          )
        }
      />
      {creating && <LeaveForm onDone={() => setCreating(false)} />}
      <div className="grid gap-6">
        <LeaveTable />
        <OvertimeTable />
      </div>
    </>
  );
}

function ReviewButtons({
  onReview,
  pending,
}: {
  onReview: (decision: 'APPROVED' | 'REJECTED') => void;
  pending: boolean;
}) {
  return (
    <div className="flex justify-end gap-1">
      <Button
        variant="ghost"
        className="px-2 py-1 text-xs"
        disabled={pending}
        icon={<Check className="size-3.5 text-good" />}
        onClick={() => onReview('APPROVED')}
      >
        Aprobar
      </Button>
      <Button
        variant="ghost"
        className="px-2 py-1 text-xs"
        disabled={pending}
        icon={<X className="size-3.5 text-critical" />}
        onClick={() => onReview('REJECTED')}
      >
        Rechazar
      </Button>
    </div>
  );
}

function LeaveTable() {
  const queryClient = useQueryClient();
  const canApprove = useAuth((s) => s.can('leave:approve'));
  const ownEmployeeId = useAuth((s) => s.user?.employeeId);
  const { data, isLoading, error } = useQuery({
    queryKey: ['leave'],
    queryFn: () => api<PaginatedResponse<LeaveRow>>('/leave-requests', { query: { pageSize: 50 } }),
  });
  const review = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: string }) =>
      api(`/leave-requests/${id}/review`, { method: 'POST', body: { decision } }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['leave'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]),
  });

  return (
    <Card>
      <CardHeader title="Permisos y vacaciones" />
      {isLoading && <Spinner />}
      {(error ?? review.error) && <ErrorState error={error ?? review.error} />}
      {data && (
        <Table
          head={['Empleado', 'Tipo', 'Desde', 'Hasta', 'Motivo', 'Estado', '']}
          empty={data.data.length === 0}
        >
          {data.data.map((l) => (
            <tr key={l.id}>
              <Td className="font-medium">
                {l.employee.lastName} {l.employee.firstName}
              </Td>
              <Td className="text-ink-2">{LEAVE_LABEL[l.type]}</Td>
              <Td className="tabular whitespace-nowrap">{formatDateTime(l.startsAt)}</Td>
              <Td className="tabular whitespace-nowrap">{formatDateTime(l.endsAt)}</Td>
              <Td className="max-w-xs truncate text-ink-2">{l.reason}</Td>
              <Td>
                <StatusBadge tone={REQUEST_STATUS[l.status].tone}>
                  {REQUEST_STATUS[l.status].label}
                </StatusBadge>
              </Td>
              <Td>
                {canApprove && l.status === 'PENDING' && l.employee.id !== ownEmployeeId && (
                  <ReviewButtons
                    pending={review.isPending}
                    onReview={(decision) => review.mutate({ id: l.id, decision })}
                  />
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function OvertimeTable() {
  const queryClient = useQueryClient();
  const canApprove = useAuth((s) => s.can('overtime:approve'));
  const ownEmployeeId = useAuth((s) => s.user?.employeeId);
  const { data, isLoading, error } = useQuery({
    queryKey: ['overtime'],
    queryFn: () =>
      api<PaginatedResponse<OvertimeRow> & { totalMinutes: number }>('/overtime', {
        query: { pageSize: 50 },
      }),
  });
  const review = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: string }) =>
      api(`/overtime/${id}/review`, { method: 'POST', body: { decision } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['overtime'] }),
  });

  return (
    <Card>
      <CardHeader
        title="Horas extra"
        subtitle={data ? `Total listado: ${formatMinutes(data.totalMinutes)}` : undefined}
      />
      {isLoading && <Spinner />}
      {(error ?? review.error) && <ErrorState error={error ?? review.error} />}
      {data && (
        <Table
          head={['Fecha', 'Empleado', 'Tipo', 'Tiempo', 'Estado', '']}
          empty={data.data.length === 0}
        >
          {data.data.map((o) => (
            <tr key={o.id}>
              <Td className="whitespace-nowrap text-ink-2">{formatDate(o.workDate)}</Td>
              <Td className="font-medium">
                {o.employee.lastName} {o.employee.firstName}
              </Td>
              <Td className="text-ink-2">{OVERTIME_LABEL[o.kind]}</Td>
              <Td className="tabular">{formatMinutes(o.minutes)}</Td>
              <Td>
                <StatusBadge tone={REQUEST_STATUS[o.status].tone}>
                  {REQUEST_STATUS[o.status].label}
                </StatusBadge>
              </Td>
              <Td>
                {canApprove && o.status === 'PENDING' && o.employee.id !== ownEmployeeId && (
                  <ReviewButtons
                    pending={review.isPending}
                    onReview={(decision) => review.mutate({ id: o.id, decision })}
                  />
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function LeaveForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<LeaveType>('PERSONAL');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [reason, setReason] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api('/leave-requests', {
        method: 'POST',
        body: {
          type,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          reason,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['leave'] });
      onDone();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Card className="mb-6">
      <form onSubmit={submit} className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Tipo">
          <Select value={type} onChange={(e) => setType(e.target.value as LeaveType)}>
            {LEAVE_TYPES.map((t) => (
              <option key={t} value={t}>
                {LEAVE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Desde">
          <Input
            type="datetime-local"
            required
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </Field>
        <Field label="Hasta">
          <Input
            type="datetime-local"
            required
            value={endsAt}
            min={startsAt}
            onChange={(e) => setEndsAt(e.target.value)}
          />
        </Field>
        <Field label="Motivo">
          <Input
            required
            minLength={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <div className="flex items-end gap-2">
          <Button
            type="submit"
            variant="primary"
            loading={create.isPending}
            disabled={!startsAt || !endsAt || reason.length < 3}
          >
            Enviar
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancelar
          </Button>
        </div>
        {create.error && (
          <p role="alert" className="text-sm text-critical sm:col-span-2 lg:col-span-5">
            {create.error.message}
          </p>
        )}
      </form>
    </Card>
  );
}
