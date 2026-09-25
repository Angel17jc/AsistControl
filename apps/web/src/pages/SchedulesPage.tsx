import { HolidaysCard } from '../components/schedules/HolidaysCard';
import { ShiftsCard } from '../components/schedules/ShiftsCard';
import { WeeklySchedulesCard } from '../components/schedules/WeeklySchedulesCard';
import { PageHeader } from '../components/ui';
import { useAuth } from '../stores/auth';

/**
 * Everything the attendance engine measures against: shifts, the weekly schedules built from
 * them, and holidays. Assigning a schedule to a person is done from their panel in Empleados.
 */
export function SchedulesPage() {
  const manage = useAuth((s) => s.can('schedules:write'));
  return (
    <>
      <PageHeader
        title="Horarios"
        description="Turnos, horarios semanales y feriados con los que se calcula la asistencia"
      />
      <div className="space-y-6">
        <ShiftsCard manage={manage} />
        <WeeklySchedulesCard manage={manage} />
        <HolidaysCard manage={manage} />
      </div>
    </>
  );
}
