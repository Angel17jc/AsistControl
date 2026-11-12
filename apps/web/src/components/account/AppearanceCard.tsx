import clsx from 'clsx';
import { Monitor, Moon, Sun } from 'lucide-react';
import { type ThemePreference, useThemePreference } from '../../lib/theme';
import { Card, CardHeader } from '../ui';

const OPTIONS: { value: ThemePreference; label: string; hint: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Claro', hint: 'Fondo blanco, el de la marca', icon: Sun },
  { value: 'dark', label: 'Oscuro', hint: 'Fondo azul noche, para poca luz', icon: Moon },
  {
    value: 'system',
    label: 'Como la computadora',
    hint: 'Claro u oscuro según el modo de Windows',
    icon: Monitor,
  },
];

/** Light, dark or the computer's mode. Applies at once and is remembered in this browser. */
export function AppearanceCard() {
  const [preference, choose] = useThemePreference();

  return (
    <Card>
      <CardHeader
        title="Apariencia"
        subtitle="Se guarda en este navegador; en otro equipo se elige de nuevo"
      />
      <fieldset className="grid gap-2 px-5 py-4 sm:grid-cols-3">
        <legend className="sr-only">Apariencia</legend>
        {OPTIONS.map(({ value, label, hint, icon: Icon }) => (
          <label
            key={value}
            className={clsx(
              'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 text-sm transition',
              preference === value
                ? 'border-accent bg-accent-soft'
                : 'border-line hover:bg-surface-2',
            )}
          >
            <input
              type="radio"
              name="appearance"
              value={value}
              checked={preference === value}
              onChange={() => choose(value)}
              className="mt-0.5 size-4 accent-[var(--accent)]"
            />
            <span className="grid gap-0.5">
              <span className="inline-flex items-center gap-1.5 font-medium text-ink-1">
                <Icon className="size-4 text-ink-2" aria-hidden />
                {label}
              </span>
              <span className="text-xs text-ink-3">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </Card>
  );
}
