import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';

interface KpiTileProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  /** Icon color only — the number itself always stays in primary ink. */
  iconClass?: string;
  detail?: string;
}

export function KpiTile({ label, value, icon: Icon, iconClass, detail }: KpiTileProps) {
  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-3">
        <Icon className={clsx('size-4', iconClass ?? 'text-ink-3')} aria-hidden />
        {label}
      </div>
      <p className="tabular mt-2 text-3xl font-semibold tracking-tight text-ink-1">{value}</p>
      {detail && <p className="mt-1 text-xs text-ink-3">{detail}</p>}
    </div>
  );
}
