import { HolidaysCard } from '../components/schedules/HolidaysCard';
import { ShiftsCard } from '../components/schedules/ShiftsCard';
import { WeeklySchedulesCard } from '../components/schedules/WeeklySchedulesCard';
import { PageHeader, PageHelp } from '../components/ui';
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
      <PageHelp>
        <p>Se arma en tres pasos y se asigna en un cuarto:</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            <strong className="text-ink-1">Turnos</strong>: las horas de una jornada. Ejemplo:
            «Oficina», 08:00–17:00, almuerzo 12:00–13:00.
          </li>
          <li>
            <strong className="text-ink-1">Horarios semanales</strong>: qué turno toca cada día.
            Ejemplo: «Lunes a viernes», con «Oficina» de lunes a viernes y descanso el fin de
            semana.
          </li>
          <li>
            <strong className="text-ink-1">Feriados</strong>: días sin trabajo para todos.
          </li>
          <li>
            Asigne el horario a cada persona en{' '}
            <strong className="text-ink-1">Empleados → Horario</strong>, desde una fecha. Sin
            horario, el sistema no sabe a qué hora debía entrar y no calcula atrasos ni horas extra.
          </li>
        </ol>
        <p>
          Las tolerancias que deje vacías en un turno toman el valor general de Configuración. Si
          cambia las horas de un turno que ya se usa, los días pasados quedan como estaban hasta que
          se recalculen, y entonces usarán las horas nuevas. Para cambiar el horario de una persona
          desde cierta fecha, mejor asígnele otro horario en Empleados.
        </p>
      </PageHelp>
      <div className="space-y-6">
        <ShiftsCard manage={manage} />
        <WeeklySchedulesCard manage={manage} />
        <HolidaysCard manage={manage} />
      </div>
    </>
  );
}
