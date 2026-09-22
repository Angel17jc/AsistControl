import type { DashboardSummary } from '@asistcontrol/shared';
import { CheckCircle2, CircleDashed, Clock, Hourglass, XCircle } from 'lucide-react';

/**
 * Part-to-whole of today's scheduled workforce as one stacked bar. Segments are separated
 * by a 2px surface gap and every segment is also listed with icon + count, so the reading
 * never depends on color alone.
 */
export function AttendanceComposition({
  attendance,
  scheduled,
}: {
  attendance: DashboardSummary['attendance'];
  scheduled: number;
}) {
  const segments = [
    {
      key: 'onTime',
      label: 'A tiempo',
      value: attendance.present - attendance.late,
      color: 'var(--good)',
      icon: CheckCircle2,
    },
    {
      key: 'late',
      label: 'Atrasados',
      value: attendance.late,
      color: 'var(--warning)',
      icon: Clock,
    },
    {
      key: 'absent',
      label: 'Ausentes',
      value: attendance.absent,
      color: 'var(--critical)',
      icon: XCircle,
    },
    {
      key: 'leave',
      label: 'Con permiso',
      value: attendance.onLeave,
      color: 'var(--series-1)',
      icon: CircleDashed,
    },
    {
      key: 'pending',
      label: 'Por llegar',
      value: attendance.pendingArrival,
      color: 'var(--neutral-mark)',
      icon: Hourglass,
    },
  ];
  const total = Math.max(
    1,
    segments.reduce((s, x) => s + x.value, 0),
  );

  return (
    <div>
      <div
        className="flex h-3 w-full gap-[2px] overflow-hidden rounded"
        role="img"
        aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(', ')}
      >
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <div
              key={s.key}
              title={`${s.label}: ${s.value}`}
              style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
              className="h-full first:rounded-l last:rounded-r"
            />
          ))}
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-5">
        {segments.map(({ key, label, value, color, icon: Icon }) => (
          <li key={key} className="flex items-center gap-2 text-sm">
            <Icon className="size-4 shrink-0" style={{ color }} aria-hidden />
            <span className="whitespace-nowrap text-ink-2">{label}</span>
            <span className="tabular ml-auto font-semibold text-ink-1 sm:ml-0">{value}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-3">{scheduled} personas con turno hoy</p>
    </div>
  );
}
