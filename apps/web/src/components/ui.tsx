import clsx from 'clsx';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  Loader2,
  MinusCircle,
  XCircle,
} from 'lucide-react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={clsx('rounded-xl border border-line bg-surface-1 shadow-sm', className)}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold text-ink-1">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>}
      </div>
      {actions}
    </header>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-1">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({
  variant = 'secondary',
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-accent text-accent-ink hover:brightness-110',
        variant === 'secondary' && 'border border-line bg-surface-1 text-ink-1 hover:bg-surface-2',
        variant === 'ghost' && 'text-ink-2 hover:bg-surface-2 hover:text-ink-1',
        variant === 'danger' && 'border border-critical/40 text-critical hover:bg-critical/10',
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

const inputClass =
  'rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-ink-1 placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(inputClass, props.className ?? 'w-full')} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={clsx(inputClass, 'pr-8', props.className ?? 'w-full')} />;
}

export function Spinner({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-ink-3">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-6 py-12 text-center">
      <CircleDashed className="mb-2 size-6 text-ink-3" aria-hidden />
      <p className="text-sm font-medium text-ink-1">{title}</p>
      {description && <p className="max-w-sm text-sm text-ink-3">{description}</p>}
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  return (
    <div
      role="alert"
      className="m-4 flex items-start gap-2 rounded-lg border border-critical/30 bg-critical/5 p-3 text-sm text-ink-1"
    >
      <XCircle className="mt-0.5 size-4 shrink-0 text-critical" aria-hidden />
      {error instanceof Error ? error.message : 'Ocurrió un error inesperado'}
    </div>
  );
}

/** Status pill: color is never the only signal — icon and label always accompany it. */
export type Tone = 'good' | 'warning' | 'serious' | 'critical' | 'neutral' | 'info';

const TONE_STYLE: Record<Tone, { dot: string; icon: typeof CheckCircle2 }> = {
  good: { dot: 'text-good', icon: CheckCircle2 },
  warning: { dot: 'text-warning', icon: Clock },
  serious: { dot: 'text-serious', icon: AlertTriangle },
  critical: { dot: 'text-critical', icon: XCircle },
  neutral: { dot: 'text-ink-3', icon: MinusCircle },
  info: { dot: 'text-accent', icon: CircleDashed },
};

export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const { dot, icon: Icon } = TONE_STYLE[tone];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface-2 px-2 py-0.5 text-xs font-medium text-ink-1">
      <Icon className={clsx('size-3.5', dot)} aria-hidden />
      {children}
    </span>
  );
}

export function Table({
  head,
  children,
  empty,
}: {
  head: ReactNode[];
  children: ReactNode;
  empty?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-3">
            {head.map((h, i) => (
              <th key={i} scope="col" className="px-4 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
      {empty && (
        <EmptyState
          title="Sin resultados"
          description="No hay datos para los filtros seleccionados."
        />
      )}
    </div>
  );
}

export function Td({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <td title={title} className={clsx('px-4 py-2.5 align-middle text-ink-1', className)}>
      {children}
    </td>
  );
}

export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3 text-sm text-ink-2">
      <Button variant="ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Anterior
      </Button>
      <span className="tabular">
        {page} / {totalPages}
      </span>
      <Button variant="ghost" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Siguiente
      </Button>
    </div>
  );
}
