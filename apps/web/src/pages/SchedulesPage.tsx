import { useQuery } from '@tanstack/react-query';
import { HolidaysCard } from '../components/schedules/HolidaysCard';
import { QuickSetupCard } from '../components/schedules/QuickSetupCard';
import { ShiftsCard } from '../components/schedules/ShiftsCard';
import { WeeklySchedulesCard } from '../components/schedules/WeeklySchedulesCard';
import { PageHeader, PageHelp } from '../components/ui';
import { api } from '../lib/api';
import type { WorkShiftRow } from '../lib/types';
import { useAuth } from '../stores/auth';

/**
 * Everything the attendance engine measures against. A company without fixed hours only needs
 * its workday and its holidays; shifts and weekly schedules stay at hand for one that has them.
 */
export function SchedulesPage() {
  const manage = useAuth((s) => s.can('schedules:write'));
  const canSetUp = useAuth((s) => s.can('schedules:write') && s.can('settings:write'));
  const shifts = useQuery({
    queryKey: ['work-shifts'],
    queryFn: () => api<WorkShiftRow[]>('/work-shifts'),
  });
  // Folded until a shift with fixed hours exists, or if this person cannot use the quick setup.
  const custom = !canSetUp || (shifts.data ?? []).some((s) => !s.flexible);

  return (
    <>
      <PageHeader
        title="Horarios"
        description="La jornada de la empresa y sus feriados, con los que se calcula la asistencia"
      />
      <PageHelp>
        <p>
          Si cada día se entra y se sale a distinta hora, basta con{' '}
          <strong className="text-ink-1">Jornada de la empresa</strong>: se indica cuántas horas se
          trabajan al día, el almuerzo y qué días, y queda aplicado a todos los empleados. Nadie se
          marca atrasado; solo se avisa si un día termina con menos horas de las esperadas.
        </p>
        <p>
          Cargue también los <strong className="text-ink-1">feriados</strong> del año: sin eso, ese
          día las personas figuran ausentes.
        </p>
        <p>
          Si alguien sí tiene hora fija, abra{' '}
          <strong className="text-ink-1">Horarios a medida</strong>: un{' '}
          <strong className="text-ink-1">turno</strong> son las horas de una jornada, un{' '}
          <strong className="text-ink-1">horario semanal</strong> dice qué turno toca cada día, y se
          asigna a cada persona en <strong className="text-ink-1">Empleados → Horario</strong>. Las
          tolerancias que deje vacías toman el valor de Configuración. Si cambia un turno que ya se
          usa, los días pasados quedan como estaban hasta que se recalculen.
        </p>
      </PageHelp>
      <div className="space-y-6">
        {canSetUp && <QuickSetupCard />}
        <HolidaysCard manage={manage} />
        <details open={custom} className="group space-y-6">
          <summary className="cursor-pointer text-sm font-medium text-ink-1">
            Horarios a medida: turnos y horarios semanales, para quien sí tiene hora fija
          </summary>
          <div className="mt-4 space-y-6">
            <ShiftsCard manage={manage} />
            <WeeklySchedulesCard manage={manage} />
          </div>
        </details>
      </div>
    </>
  );
}
