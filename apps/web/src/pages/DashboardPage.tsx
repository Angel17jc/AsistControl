import type { DashboardSummary } from '@asistcontrol/shared';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, CircleDashed, Clock, Cpu, Timer, XCircle } from 'lucide-react';
import { useEffect } from 'react';
import { AttendanceComposition } from '../components/dashboard/AttendanceComposition';
import { HourlyPunchesChart } from '../components/dashboard/HourlyPunchesChart';
import { KpiTile } from '../components/dashboard/KpiTile';
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Spinner,
  Table,
  Td,
} from '../components/ui';
import { api } from '../lib/api';
import {
  PUNCH_LABEL,
  formatDate,
  formatMinutes,
  formatTime,
  setDisplayTimezone,
} from '../lib/format';

export function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardSummary>('/dashboard/summary'),
    // Realtime keeps the feed fresh; the periodic refetch recomputes "absent" as shifts start.
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (data?.timezone) setDisplayTimezone(data.timezone);
  }, [data?.timezone]);

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorState error={error} />;

  const { attendance, devices } = data;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Hoy, ${formatDate(data.date)} · ${data.employees.active} empleados activos`}
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile
          label="Presentes"
          value={attendance.present}
          icon={CheckCircle2}
          iconClass="text-good"
          detail={`de ${data.employees.scheduledToday} con turno`}
        />
        <KpiTile label="Atrasados" value={attendance.late} icon={Clock} iconClass="text-warning" />
        <KpiTile
          label="Ausentes"
          value={attendance.absent}
          icon={XCircle}
          iconClass="text-critical"
          detail={`${attendance.pendingArrival} por llegar`}
        />
        <KpiTile
          label="Permisos"
          value={attendance.onLeave}
          icon={CircleDashed}
          iconClass="text-accent"
          detail={`${data.pendingRequests.leave} por aprobar`}
        />
        <KpiTile
          label="Horas extra"
          value={formatMinutes(data.overtimeMinutesMonth)}
          icon={Timer}
          detail={`mes · ${data.pendingRequests.overtime} por aprobar`}
        />
        <KpiTile
          label="Dispositivos"
          value={`${devices.online} / ${devices.total}`}
          icon={Cpu}
          iconClass={devices.online === devices.total ? 'text-good' : 'text-critical'}
          detail={
            devices.offline + devices.error > 0
              ? `${devices.offline} desconectados · ${devices.error} con error`
              : 'Todos en línea'
          }
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="Asistencia de hoy" subtitle="Personas con turno programado" />
          <div className="p-5">
            <AttendanceComposition
              attendance={attendance}
              scheduled={data.employees.scheduledToday}
            />
          </div>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Marcaciones por hora" subtitle="Hoy, hora local" />
          <div className="px-3 pb-3">
            <HourlyPunchesChart data={data.hourlyPunches} />
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Últimas marcaciones" subtitle="Se actualiza en tiempo real" />
        {data.latestEvents.length === 0 ? (
          <EmptyState
            title="Aún no hay marcaciones hoy"
            description="Las marcaciones aparecerán aquí en cuanto lleguen de los dispositivos."
          />
        ) : (
          <Table head={['Hora', 'Empleado', 'Tipo', 'Dispositivo']}>
            {data.latestEvents.map((e) => (
              <tr key={e.id} className="hover:bg-surface-2/60">
                <Td className="tabular font-medium">{formatTime(e.occurredAt)}</Td>
                <Td>
                  {e.employee ? (
                    <>
                      {e.employee.fullName}{' '}
                      <span className="text-xs text-ink-3">{e.employee.employeeCode}</span>
                    </>
                  ) : (
                    <span className="text-ink-3">
                      ID biométrico {e.deviceUserId} (sin empleado)
                    </span>
                  )}
                </Td>
                <Td className="text-ink-2">{PUNCH_LABEL[e.punchType]}</Td>
                <Td className="text-ink-2">{e.deviceName ?? 'Manual'}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
