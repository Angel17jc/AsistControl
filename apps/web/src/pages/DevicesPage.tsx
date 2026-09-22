import type { PaginatedResponse } from '@asistcontrol/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Plug, Plus, RefreshCw, Unplug, Zap } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { DEVICE_STATUS, SYNC_STATUS } from '../components/status';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
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
import { formatDateTime, relativeTime, todayIso } from '../lib/format';
import type { DeviceRow, SimulatorState, SyncLogRow } from '../lib/types';
import { useAuth } from '../stores/auth';

const SCENARIOS = [
  ['MIXED', 'Mixto (realista)'],
  ['ON_TIME', 'Todos puntuales'],
  ['LATE', 'Atrasos'],
  ['EARLY_LEAVE', 'Salidas anticipadas'],
  ['OVERTIME', 'Horas extra'],
  ['MISSING_EXIT', 'Olvidan marcar salida'],
  ['NO_LUNCH', 'Sin marcar almuerzo'],
  ['DUPLICATE_PUNCH', 'Doble marcación'],
  ['ABSENT', 'Ausencias'],
] as const;

export function DevicesPage() {
  const canWrite = useAuth((s) => s.can('devices:write'));
  const [creating, setCreating] = useState(false);
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api<DeviceRow[]>('/devices') });
  const logs = useQuery({
    queryKey: ['sync-logs'],
    queryFn: () => api<PaginatedResponse<SyncLogRow>>('/sync-logs', { query: { pageSize: 15 } }),
  });

  return (
    <>
      <PageHeader
        title="Dispositivos"
        description="Marcadores biométricos conectados por red LAN"
        actions={
          canWrite && (
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              onClick={() => setCreating(true)}
            >
              Registrar dispositivo
            </Button>
          )
        }
      />
      {creating && <DeviceForm onDone={() => setCreating(false)} />}
      {devices.isLoading && <Spinner />}
      {devices.error && <ErrorState error={devices.error} />}
      {devices.data?.length === 0 && (
        <Card>
          <EmptyState
            title="No hay dispositivos registrados"
            description="Registre un marcador (o uno simulado con el driver MOCK) para comenzar."
          />
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        {devices.data?.map((d) => (
          <DeviceCard key={d.id} device={d} />
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader title="Historial de sincronización" subtitle="Últimas 15 ejecuciones" />
        {logs.isLoading && <Spinner />}
        {logs.data && (
          <Table
            head={[
              'Inicio',
              'Dispositivo',
              'Origen',
              'Estado',
              'Recibidos',
              'Procesados',
              'Duplicados',
              'Rechazados',
              'Sin empleado',
            ]}
            empty={logs.data.data.length === 0}
          >
            {logs.data.data.map((l) => (
              <tr key={l.id}>
                <Td className="tabular whitespace-nowrap">{formatDateTime(l.startedAt)}</Td>
                <Td>{l.device.name}</Td>
                <Td className="text-ink-2">
                  {
                    { MANUAL: 'Manual', SCHEDULED: 'Programada', REALTIME: 'Tiempo real' }[
                      l.trigger
                    ]
                  }
                </Td>
                <Td>
                  <StatusBadge tone={SYNC_STATUS[l.status].tone}>
                    {SYNC_STATUS[l.status].label}
                  </StatusBadge>
                  {l.errorMessage && (
                    <p className="mt-1 max-w-56 truncate text-xs text-ink-3" title={l.errorMessage}>
                      {l.errorMessage}
                    </p>
                  )}
                </Td>
                <Td className="tabular">{l.recordsReceived}</Td>
                <Td className="tabular">{l.recordsProcessed}</Td>
                <Td className="tabular">{l.recordsDuplicated}</Td>
                <Td className="tabular">{l.recordsRejected}</Td>
                <Td className="tabular">{l.recordsUnmatched}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

function DeviceCard({ device }: { device: DeviceRow }) {
  const queryClient = useQueryClient();
  const canSync = useAuth((s) => s.can('devices:sync'));
  const canWrite = useAuth((s) => s.can('devices:write'));
  const [message, setMessage] = useState<string | null>(null);
  const refresh = () =>
    Promise.all(
      ['devices', 'sync-logs', 'dashboard'].map((k) =>
        queryClient.invalidateQueries({ queryKey: [k] }),
      ),
    );

  const test = useMutation({
    mutationFn: () =>
      api<{
        reachable: boolean;
        latencyMs: number;
        error: string | null;
        info: { clockDriftSeconds: number } | null;
      }>(`/devices/${device.id}/test-connection`, { method: 'POST' }),
    onSuccess: async (r) => {
      setMessage(
        r.reachable
          ? `Conectado en ${r.latencyMs} ms · desfase de reloj ${r.info?.clockDriftSeconds ?? 0} s`
          : `Sin respuesta: ${r.error}`,
      );
      await refresh();
    },
  });
  const sync = useMutation({
    mutationFn: () => api<SyncLogRow>(`/devices/${device.id}/sync`, { method: 'POST' }),
    onSuccess: async (l) => {
      setMessage(
        l.status === 'FAILED'
          ? `Sincronización fallida: ${l.errorMessage}`
          : `${l.recordsProcessed} nuevas · ${l.recordsDuplicated} duplicadas · ${l.recordsRejected} rechazadas`,
      );
      await refresh();
    },
  });
  const status = DEVICE_STATUS[device.status];
  const error = test.error ?? sync.error;

  return (
    <Card>
      <CardHeader
        title={device.name}
        subtitle={`${device.manufacturer} ${device.model} · ${device.host}:${device.port}${device.location ? ` · ${device.location}` : ''}`}
        actions={<StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
      />
      <div className="space-y-4 p-5">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-ink-3">Última sincronización</dt>
            <dd className="text-ink-1">{relativeTime(device.lastSyncAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">Driver / serie</dt>
            <dd className="text-ink-1">
              {device.driver} · {device.serialNumber ?? '—'}
            </dd>
          </div>
        </dl>
        {device.lastError && (
          <p className="rounded-lg bg-critical/10 px-3 py-2 text-xs text-ink-1">
            {device.lastError}
          </p>
        )}
        {canSync && (
          <div className="flex flex-wrap gap-2">
            <Button
              icon={<Plug className="size-4" />}
              loading={test.isPending}
              onClick={() => test.mutate()}
              disabled={device.status === 'DISABLED'}
            >
              Probar conexión
            </Button>
            <Button
              variant="primary"
              icon={<RefreshCw className="size-4" />}
              loading={sync.isPending}
              onClick={() => sync.mutate()}
              disabled={device.status === 'DISABLED'}
            >
              Sincronizar
            </Button>
          </div>
        )}
        {message && (
          <p className="text-sm text-ink-2" aria-live="polite">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-critical">
            {error.message}
          </p>
        )}
        {device.driver === 'MOCK' && canWrite && (
          <SimulatorPanel deviceId={device.id} onChange={setMessage} />
        )}
      </div>
    </Card>
  );
}

/** Drives the virtual terminal. Data still reaches the platform only via sync/realtime. */
function SimulatorPanel({
  deviceId,
  onChange,
}: {
  deviceId: string;
  onChange: (m: string) => void;
}) {
  const queryClient = useQueryClient();
  const [scenario, setScenario] = useState<string>('MIXED');
  const [date, setDate] = useState(todayIso());
  const state = useQuery({
    queryKey: ['simulator', deviceId],
    queryFn: () => api<SimulatorState>(`/devices/${deviceId}/simulate`),
  });
  const run = useMutation({
    mutationFn: ({ path, body }: { path: string; body: object }) =>
      api<unknown>(`/devices/${deviceId}/simulate/${path}`, { method: 'POST', body }),
    onSuccess: (result, { path }) => {
      void queryClient.invalidateQueries({ queryKey: ['simulator', deviceId] });
      if (path === 'workday') {
        const r = result as { employees: number; punches: number };
        onChange(
          `Jornada generada: ${r.punches} marcaciones de ${r.employees} empleados en la memoria del equipo. Pulse "Sincronizar".`,
        );
      }
    },
  });
  const s = state.data;

  return (
    <div className="rounded-lg border border-dashed border-line bg-surface-2/50 p-4">
      <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
        <FlaskConical className="size-4" aria-hidden /> Simulador
        {s && (
          <span className="ml-auto font-normal normal-case tracking-normal">
            {s.storedLogs} registros en memoria · {s.enrolledUsers} usuarios
          </span>
        )}
      </p>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <Field label="Escenario">
          <Select value={scenario} onChange={(e) => setScenario(e.target.value)}>
            {SCENARIOS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Fecha">
          <Input
            type="date"
            value={date}
            max={todayIso()}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Button
          loading={run.isPending && run.variables?.path === 'workday'}
          onClick={() => run.mutate({ path: 'workday', body: { date, scenario } })}
        >
          Generar jornada
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="ghost"
          icon={s?.online === false ? <Plug className="size-4" /> : <Unplug className="size-4" />}
          onClick={() => run.mutate({ path: 'faults', body: { online: !(s?.online ?? true) } })}
        >
          {s?.online === false ? 'Reconectar equipo' : 'Desconectar equipo'}
        </Button>
        <Button
          variant="ghost"
          icon={<Zap className="size-4" />}
          onClick={() =>
            run.mutate({ path: 'auto', body: { intervalMs: s?.autoGenerating ? 0 : 5000 } })
          }
        >
          {s?.autoGenerating ? 'Detener marcaciones en vivo' : 'Marcaciones en vivo (cada 5 s)'}
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            run.mutate({ path: 'faults', body: { duplicateOnRead: !s?.duplicateOnRead } })
          }
        >
          {s?.duplicateOnRead ? 'Quitar lecturas duplicadas' : 'Simular lecturas duplicadas'}
        </Button>
        <Button
          variant="ghost"
          onClick={() => run.mutate({ path: 'faults', body: { reset: true } })}
        >
          Restablecer fallos
        </Button>
      </div>
      {run.error && (
        <p role="alert" className="mt-2 text-sm text-critical">
          {run.error.message}
        </p>
      )}
    </div>
  );
}

function DeviceForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const drivers = useQuery({
    queryKey: ['devices', 'drivers'],
    queryFn: () => api<string[]>('/devices/drivers'),
  });
  const [form, setForm] = useState({
    name: '',
    driver: 'MOCK',
    manufacturer: 'AsistControl',
    model: 'AC-SIM-100',
    host: '192.168.1.210',
    port: '4370',
    location: '',
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const create = useMutation({
    mutationFn: () =>
      api('/devices', {
        method: 'POST',
        body: {
          ...form,
          port: Number(form.port),
          location: form.location || undefined,
          config: { realtime: true },
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['devices'] });
      onDone();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Card className="mb-6">
      <form onSubmit={submit} className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Nombre">
          <Input required value={form.name} onChange={set('name')} placeholder="Entrada planta 2" />
        </Field>
        <Field label="Driver">
          <Select value={form.driver} onChange={set('driver')}>
            {drivers.data?.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Fabricante">
          <Input required value={form.manufacturer} onChange={set('manufacturer')} />
        </Field>
        <Field label="Modelo">
          <Input required value={form.model} onChange={set('model')} />
        </Field>
        <Field label="IP / host">
          <Input required value={form.host} onChange={set('host')} />
        </Field>
        <Field label="Puerto">
          <Input
            required
            type="number"
            min={1}
            max={65535}
            value={form.port}
            onChange={set('port')}
          />
        </Field>
        <Field label="Ubicación">
          <Input value={form.location} onChange={set('location')} />
        </Field>
        <div className="flex items-end gap-2">
          <Button type="submit" variant="primary" loading={create.isPending}>
            Registrar
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancelar
          </Button>
        </div>
        {create.error && (
          <p role="alert" className="text-sm text-critical sm:col-span-2 lg:col-span-4">
            {create.error.message}
          </p>
        )}
      </form>
    </Card>
  );
}
